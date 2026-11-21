import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { CallBridge } from "../src/bridge.mjs";
import { LiveKitSide, MAX_PENDING } from "../src/livekit.mjs";
import { FRAME_LEN } from "../src/mixer.mjs";
import { Reconciler, fetchState, plan, withTimeout } from "../src/plan.mjs";

const link = (id, o = {}) => ({ channel_id: id, room: `cdg-${id}`, guild_id: "g1", discord_channel_id: `dc${id}`, active: true, ...o });
const opts = (o = {}) => ({ now: 100_000, retryAt: new Map(), graceMs: 20_000, ...o });
const open = (...links) => new Map(links.map((l) => [l.channel_id, { link: l, idleSince: null }]));

test("duas calls no mesmo servidor do Discord: só uma pega o bot, a outra espera", () => {
  const r = plan([link("1"), link("2")], new Map(), opts());
  assert.deepEqual(r.open.map((l) => l.channel_id), ["1"]);
  assert.deepEqual(r.waiting.map((w) => [w.link.channel_id, w.holder]), [["2", "1"]]);

  // com a 1 aberta, a 2 continua esperando (não rouba a conexão)
  const again = plan([link("1"), link("2")], open(link("1")), opts());
  assert.deepEqual(again.open, []);
  assert.deepEqual(again.close, []);
  assert.equal(again.waiting[0].holder, "1");
});

test("servidores diferentes do Discord abrem juntos", () => {
  const r = plan([link("1"), link("2", { guild_id: "g2" })], new Map(), opts());
  assert.deepEqual(r.open.map((l) => l.channel_id), ["1", "2"]);
});

test("quando a call que tinha o bot fecha, a que esperava entra na mesma volta", () => {
  const r = plan([link("2")], open(link("1")), opts());
  assert.deepEqual(r.close, [{ id: "1", why: "ligação desfeita" }]);
  assert.deepEqual(r.open.map((l) => l.channel_id), ["2"]);
});

test("trocar o canal ligado fecha a ponte velha (o áudio não vai mais para o destino antigo)", () => {
  const bridges = open(link("1"));
  const moved = link("1", { discord_channel_id: "dcOutro" });
  const r = plan([moved], bridges, opts());
  assert.deepEqual(r.close, [{ id: "1", why: "ligação trocou de destino" }]);
  assert.deepEqual(r.open, [], "abre a nova só na volta seguinte, depois de sair da velha");
  bridges.delete("1");
  assert.deepEqual(plan([moved], bridges, opts()).open, [moved]);
  // trocar de servidor também conta
  assert.equal(plan([link("1", { guild_id: "g9" })], open(link("1")), opts()).close.length, 1);
});

test("um lado vazio: espera a tolerância antes de fechar", () => {
  const bridges = open(link("1"));
  const idle = link("1", { active: false });
  assert.deepEqual(plan([idle], bridges, opts({ now: 0 })).close, []);
  assert.deepEqual(plan([idle], bridges, opts({ now: 15_000 })).close, []);
  assert.deepEqual(plan([idle], bridges, opts({ now: 25_000 })).close, [{ id: "1", why: "um dos lados ficou vazio" }]);
  // voltou gente: zera a contagem
  const b2 = open(link("1"));
  plan([idle], b2, opts({ now: 0 }));
  plan([link("1")], b2, opts({ now: 10_000 }));
  assert.equal(b2.get("1").idleSince, null);
});

test("depois de falhar, espera o tempo de tentar de novo", () => {
  const r = plan([link("1")], new Map(), opts({ retryAt: new Map([["1", 200_000]]) }));
  assert.deepEqual(r.open, []);
});

test("a consulta à API desiste se ela não responder", async () => {
  const server = http.createServer(() => {}); // nunca responde
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const api = `http://127.0.0.1:${server.address().port}`;
  const t0 = Date.now();
  await assert.rejects(fetchState(api, "s", { timeoutMs: 300 }), /abort|timeout/i);
  assert.ok(Date.now() - t0 < 2000, "não ficou presa");
  server.closeAllConnections();
  server.close();
});

test("a consulta à API manda o segredo e lê a resposta", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ secret: req.headers["x-bridge-secret"], links: [] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const d = await fetchState(`http://127.0.0.1:${server.address().port}`, "segredo");
  assert.equal(d.secret, "segredo");
  server.close();
});

test("withTimeout: passou do prazo, rejeita", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 50, "entrar na call"), /entrar na call/);
  assert.equal(await withTimeout(Promise.resolve(7), 50, "x"), 7);
});

test("LiveKit atrasado: não empilha quadros, descarta e volta quando ele alivia", async () => {
  const side = new LiveKitSide({ url: "", token: "", onPcm() {}, onEnd() {} });
  const waiting = [];
  side.source = { captureFrame: () => new Promise((r) => waiting.push(r)) };
  const frame = new Int16Array(FRAME_LEN);
  const sent = Array.from({ length: 10 }, () => side.send(frame));
  assert.equal(sent.filter(Boolean).length, MAX_PENDING, "só alguns ficam esperando");
  assert.equal(side.dropped, 10 - MAX_PENDING);
  waiting.splice(0).forEach((r) => r());
  await new Promise((r) => setImmediate(r));
  assert.equal(side.pending, 0);
  assert.equal(side.send(frame), true, "aliviou: volta a mandar");
  // captureFrame que falha também libera a vaga
  side.source = { captureFrame: () => Promise.reject(new Error("x")) };
  side.pending = 0;
  side.send(frame);
  await new Promise((r) => setImmediate(r));
  assert.equal(side.pending, 0);
});

test("ponte parada enquanto entrava: nenhum lado fica conectado", async () => {
  const calls = [];
  let releaseApp;
  const fake = (name, wait) => () => ({
    start: () => {
      calls.push(`${name}.start`);
      return wait ? new Promise((r) => (releaseApp = r)) : Promise.resolve();
    },
    send() {},
    stop: async () => calls.push(`${name}.stop`),
  });
  const b = new CallBridge({ makeDiscord: fake("discord"), makeApp: fake("app", true) });
  const starting = b.start();
  await b.stop(); // o prazo estourou, por exemplo
  releaseApp();
  await assert.rejects(starting, /parada/);
  assert.ok(!calls.includes("discord.start"), "não entra no Discord depois de parada");
  assert.ok(calls.filter((c) => c === "app.stop").length >= 1);
  assert.equal(b.stopClock, undefined, "o relógio nem começou");
});

// ---- Reconciler: prazo de validade do estado (fail-closed) ----

/** Mundo de mentira: API, relógio e pontes controláveis. */
function world({ staleMs = 15_000 } = {}) {
  const w = { t: 0, links: [], apiUp: true, made: [], hang: new Set() };
  w.r = new Reconciler({
    now: () => w.t,
    graceMs: 20_000,
    staleMs,
    startTimeoutMs: 45_000,
    stopTimeoutMs: 50,
    fetchState: async () => {
      if (!w.apiUp) throw new Error("API fora");
      return { links: w.links.map((l) => ({ ...l })) };
    },
    makeBridge: async (link) => {
      const b = { link, started: false, stopped: false, resolve: null };
      b.start = () =>
        w.hang.has(link.channel_id)
          ? new Promise((res) => (b.resolve = () => ((b.started = true), res())))
          : ((b.started = true), Promise.resolve());
      b.stop = async () => {
        b.stopped = true;
      };
      w.made.push(b);
      return b;
    },
  });
  w.live = () => w.made.filter((b) => b.started && !b.stopped).map((b) => b.link.channel_id);
  return w;
}
const settle = () => new Promise((r) => setImmediate(r));

test("API caiu: as pontes ficam até o prazo e desligam depois, sem esperar a API voltar", async () => {
  const w = world();
  w.links = [link("1")];
  await w.r.tick();
  await settle();
  assert.deepEqual(w.live(), ["1"]);

  w.apiUp = false;
  for (const t of [3000, 6000, 9000, 12_000, 15_000]) {
    w.t = t;
    await w.r.tick();
  }
  assert.deepEqual(w.live(), ["1"], "dentro dos 15 s continua (uma falha passageira não corta a call)");

  w.t = 15_001;
  assert.equal(w.r.check(), 1, "o relógio próprio fecha sem precisar de volta");
  await settle();
  assert.deepEqual(w.live(), []);
  assert.equal(w.r.bridges.size, 0);

  // falhas seguidas: não reabre com o estado velho
  for (const t of [18_000, 21_000, 40_000]) {
    w.t = t;
    await w.r.tick();
    await settle();
  }
  assert.deepEqual(w.live(), []);
  assert.equal(w.made.length, 1, "nenhuma ponte nova sem resposta da API");

  // API voltou com a ligação ainda lá: reabre (e não ficou de castigo de 30 s)
  w.apiUp = true;
  w.t = 43_000;
  await w.r.tick();
  await settle();
  assert.deepEqual(w.live(), ["1"]);
});

test("API voltou dizendo que a ligação foi desfeita: não reabre", async () => {
  const w = world();
  w.links = [link("1")];
  await w.r.tick();
  await settle();
  w.apiUp = false;
  w.t = 16_000;
  w.r.check();
  await settle();
  w.links = [];
  w.apiUp = true;
  w.t = 19_000;
  await w.r.tick();
  await settle();
  assert.deepEqual(w.live(), []);
  assert.equal(w.made.length, 1);
});

test("resposta sem a lista de ligações conta como falha, não como 'nada ligado'", async () => {
  const w = world();
  w.links = [link("1")];
  await w.r.tick();
  await settle();
  w.r.fetchState = async () => ({});
  w.t = 3000;
  await w.r.tick();
  assert.deepEqual(w.live(), ["1"]);
  assert.equal(w.r.failures, 1);
});

test("ligação removida e trocada de destino desligam na volta seguinte", async () => {
  const w = world();
  w.links = [link("1"), link("2", { guild_id: "g2" })];
  await w.r.tick();
  await settle();
  assert.deepEqual(w.live().sort(), ["1", "2"]);

  w.links = [link("2", { guild_id: "g2", discord_channel_id: "outro" })];
  w.t = 3000;
  await w.r.tick();
  await settle();
  assert.deepEqual(w.live(), [], "a 1 saiu e a 2 trocou de destino: as duas param");

  w.t = 6000;
  await w.r.tick();
  await settle();
  assert.deepEqual(w.live(), ["2"]);
  assert.equal(w.made.at(-1).link.discord_channel_id, "outro", "reabre no destino novo");
});

test("abertura travada não segura as outras pontes nem o fechamento", async () => {
  const w = world();
  w.hang.add("1");
  w.links = [link("1"), link("2", { guild_id: "g2" })];
  await w.r.tick(); // volta termina mesmo com a 1 presa entrando
  await settle();
  assert.deepEqual(w.live(), ["2"]);

  // na volta seguinte a 2 foi desfeita: desliga já, sem esperar a 1 terminar de entrar
  w.links = [link("1")];
  w.t = 3000;
  await w.r.tick();
  await settle();
  assert.deepEqual(w.live(), []);
  assert.ok(w.made.find((b) => b.link.channel_id === "2").stopped);

  // API some com a 1 ainda entrando: o relógio próprio desliga a que está entrando
  w.apiUp = false;
  w.t = 19_000;
  assert.equal(w.r.check(), 1);
  await settle();
  const b1 = w.made.find((b) => b.link.channel_id === "1");
  assert.ok(b1.stopped, "saiu dos dois lados");
  b1.resolve(); // a entrada termina depois: não pode ficar ligada
  await settle();
  await settle();
  assert.equal(w.r.bridges.size, 0);
});

test("entrou depois que a API parou de confirmar: desliga na hora", async () => {
  const w = world();
  w.hang.add("1");
  w.links = [link("1")];
  await w.r.tick();
  await settle();
  const b = w.made[0];
  w.t = 16_000; // sem nova resposta, e o check() ainda não rodou
  b.resolve();
  await settle();
  await settle();
  assert.ok(b.stopped);
  assert.equal(w.r.bridges.size, 0);
});

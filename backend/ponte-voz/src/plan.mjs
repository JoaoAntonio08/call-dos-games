// O que fazer a cada volta: quais pontes fechar e quais abrir, a partir das calls ligadas que a API informa.
// Fica separado do index.mjs para dar para testar sem Discord nem LiveKit.
//
// Regras:
// - Ligação desfeita: fecha na hora.
// - Ligação trocada de destino (outro canal do Discord, outro servidor, outra sala): fecha a antiga já,
//   senão o áudio continua indo para o lugar velho. A nova abre na volta seguinte.
// - Um lado ficou vazio: fecha depois do tempo de tolerância.
// - Um bot só fica numa call por servidor do Discord: duas calls daqui ligadas a canais do mesmo servidor
//   não disputam a conexão. Quem pegou primeiro fica; a outra espera o servidor liberar.

/** O destino da ponte: se qualquer um destes mudar, a ponte aberta já não serve. */
export function target(link) {
  return `${link.guild_id}/${link.discord_channel_id}/${link.room}`;
}

/**
 * @param {Array<object>} links                       o que a API respondeu (links[])
 * @param {Map<string, {link: object, idleSince: number | null}>} bridges   pontes abertas, por canal daqui
 * @param {object} o
 * @param {number} o.now
 * @param {Map<string, number>} o.retryAt                canal -> quando pode tentar de novo
 * @param {number} o.graceMs
 * @returns {{close: Array<{id: string, why: string}>, open: object[], waiting: Array<{link: object, holder: string}>}}
 */
export function plan(links, bridges, { now, retryAt, graceMs }) {
  const close = [];
  const closing = new Set();
  const byId = new Map(links.map((l) => [l.channel_id, l]));

  for (const [id, entry] of bridges) {
    const link = byId.get(id);
    if (!link) {
      close.push({ id, why: "ligação desfeita" });
      closing.add(id);
    } else if (target(link) !== target(entry.link)) {
      close.push({ id, why: "ligação trocou de destino" });
      closing.add(id);
    } else if (link.active) {
      entry.idleSince = null;
    } else {
      entry.idleSince ??= now;
      if (now - entry.idleSince > graceMs) {
        close.push({ id, why: "um dos lados ficou vazio" });
        closing.add(id);
      }
    }
  }

  // servidores do Discord que já têm o bot numa call (das pontes que continuam abertas)
  const guildHolder = new Map();
  for (const [id, entry] of bridges) if (!closing.has(id)) guildHolder.set(entry.link.guild_id, id);

  const open = [];
  const waiting = [];
  for (const link of links) {
    if (!link.active || bridges.has(link.channel_id) || closing.has(link.channel_id)) continue;
    if ((retryAt.get(link.channel_id) ?? 0) > now) continue;
    const holder = guildHolder.get(link.guild_id);
    if (holder !== undefined) {
      waiting.push({ link, holder });
      continue;
    }
    guildHolder.set(link.guild_id, link.channel_id);
    open.push(link);
  }
  return { close, open, waiting };
}

/** Promessa com prazo: passou do tempo, rejeita (quem chamou limpa o que ficou pela metade). */
export function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: passou de ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pergunta à API o estado das calls ligadas, sem nunca ficar presa esperando. */
export async function fetchState(api, secret, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${api}/internal/discord-voice`, {
    headers: { "x-bridge-secret": secret },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`API respondeu ${r.status}`);
  return r.json();
}

/**
 * Quem manda nas pontes. A cada volta pergunta à API e aplica o plan().
 *
 * Fecha por falta de confirmação (fail-closed): a ponte só continua ligada enquanto a API confirma a ligação.
 * Passou de staleMs sem uma resposta válida, fecha todas (inclusive as que ainda estão entrando) e só volta
 * a abrir com uma resposta nova. O check() roda num relógio próprio, então fecha mesmo se a API ou uma
 * abertura estiver travada.
 *
 * Aberturas não seguram a volta: cada uma corre por conta própria, e a reconciliação das outras pontes
 * continua a cada volta.
 */
export class Reconciler {
  /**
   * @param {object} o
   * @param {() => Promise<{links?: object[]}>} o.fetchState
   * @param {(link: object, cb: {onClose: () => void}) => Promise<{start: () => Promise<void>, stop: () => Promise<void>}>} o.makeBridge
   * @param {number} o.graceMs           lado vazio por este tempo: fecha
   * @param {number} o.staleMs           sem confirmação da API por este tempo: fecha tudo
   * @param {number} o.startTimeoutMs    prazo para entrar nos dois lados
   * @param {number} [o.stopTimeoutMs]   prazo para sair (a ponte já saiu do mapa antes disso)
   * @param {number} [o.retryMs]         depois de falhar ao abrir, espera isto
   * @param {() => number} [o.now]
   * @param {(...a: unknown[]) => void} [o.log]
   */
  constructor({ fetchState, makeBridge, graceMs, staleMs, startTimeoutMs, stopTimeoutMs = 5000, retryMs = 30_000, now = Date.now, log = () => {} }) {
    Object.assign(this, { fetchState, makeBridge, graceMs, staleMs, startTimeoutMs, stopTimeoutMs, retryMs, now, log });
    /** @type {Map<string, {link: object, idleSince: number | null, bridge: object | null, closed: boolean, ready: boolean}>} */
    this.bridges = new Map();
    this.retryAt = new Map();
    this.waitingLogged = new Map();
    /** quando a API respondeu bem pela última vez (null: nunca) */
    this.lastOkAt = null;
    this.failures = 0;
  }

  /** A última resposta da API ainda vale? */
  fresh() {
    return this.lastOkAt !== null && this.now() - this.lastOkAt <= this.staleMs;
  }

  /** Uma volta: pergunta, fecha o que saiu, dispara o que entrou (sem esperar). */
  async tick() {
    let s;
    try {
      s = await this.fetchState();
      if (!s || !Array.isArray(s.links)) throw new Error("resposta sem a lista de ligações");
    } catch (e) {
      this.failures += 1;
      if (this.failures === 1 || this.failures % 10 === 0) this.log(`não consegui falar com a API (${e.message}; ${this.failures}ª falha seguida)`);
      this.check();
      return;
    }
    if (this.failures) this.log(`API voltou depois de ${this.failures} falha(s)`);
    this.failures = 0;
    this.lastOkAt = this.now();
    const todo = plan(s.links, this.bridges, { now: this.now(), retryAt: this.retryAt, graceMs: this.graceMs });
    // fecha antes de abrir: libera o bot no servidor do Discord e para o áudio no destino velho
    await Promise.allSettled(todo.close.map(({ id, why }) => this.close(id, why)));
    for (const link of todo.open) {
      this.waitingLogged.delete(link.channel_id);
      void this.open(link);
    }
    for (const { link, holder } of todo.waiting) {
      if (this.waitingLogged.get(link.channel_id) === holder) continue;
      this.waitingLogged.set(link.channel_id, holder);
      this.log(`call ${link.channel_id}: esperando, o bot já está na call ${holder} do mesmo servidor do Discord`);
    }
  }

  /** Sem confirmação da API há tempo demais: fecha tudo. Devolve quantas fechou. */
  check() {
    if (this.fresh() || !this.bridges.size) return 0;
    const ids = [...this.bridges.keys()];
    const age = this.lastOkAt === null ? "nunca respondeu" : `${Math.round((this.now() - this.lastOkAt) / 1000)} s sem resposta`;
    this.log(`API sem confirmar as ligações (${age}): desligando ${ids.length} ponte(s) até ela voltar`);
    for (const id of ids) void this.close(id, "API sem confirmar a ligação");
    return ids.length;
  }

  async open(link) {
    const id = link.channel_id;
    const entry = { link, idleSince: null, bridge: null, closed: false, ready: false };
    this.bridges.set(id, entry);
    try {
      const bridge = await this.makeBridge(link, {
        onClose: () => {
          // só fecha a ponte desta entrada (a call pode já ter uma ponte nova para outro destino)
          if (this.bridges.get(id) !== entry) return;
          this.log(`call ${id}: um dos lados caiu; tento de novo na próxima volta`);
          void this.close(id, "um dos lados caiu");
        },
      });
      entry.bridge = bridge;
      if (entry.closed) throw new Error("desligada enquanto preparava");
      await withTimeout(bridge.start(), this.startTimeoutMs, "entrar na call");
      // entrou, mas o mundo pode ter mudado enquanto entrava
      if (entry.closed) throw new Error("desligada enquanto entrava");
      if (!this.fresh()) throw new Error("a API parou de confirmar enquanto entrava");
      entry.ready = true;
      this.log(`call ${id}: ponte ligada (${link.app_people} aqui, ${link.discord_people} no Discord)`);
    } catch (e) {
      const mine = this.bridges.get(id) === entry;
      if (mine) this.bridges.delete(id);
      const wasClosed = entry.closed;
      entry.closed = true;
      await this.stopBridge(entry);
      // desligada de propósito (ligação desfeita, API sumiu): não é falha, não precisa esperar para tentar de novo
      if (mine && !wasClosed) {
        this.retryAt.set(id, this.now() + this.retryMs);
        this.log(`call ${id}: não deu para ligar (${e.message}); tento de novo em ${Math.round(this.retryMs / 1000)} s`);
      }
    }
  }

  async close(id, why = "") {
    const entry = this.bridges.get(id);
    if (!entry) return;
    // sai do mapa na hora: o estado já é "desligada", mesmo que a saída demore
    this.bridges.delete(id);
    entry.closed = true;
    await this.stopBridge(entry);
    this.log(`call ${id}: ponte desligada${why ? ` (${why})` : ""}`);
  }

  async closeAll(why) {
    await Promise.allSettled([...this.bridges.keys()].map((id) => this.close(id, why)));
  }

  async stopBridge(entry) {
    if (!entry.bridge) return;
    await withTimeout(entry.bridge.stop(), this.stopTimeoutMs, "sair da call").catch((e) => this.log(`saída demorou (${e.message})`));
  }
}

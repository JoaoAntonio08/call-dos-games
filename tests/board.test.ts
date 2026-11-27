import assert from "node:assert/strict";
import test from "node:test";

import { LIMITS, applyBoardMsg, cleanStroke, hitByEraser, leadsBoard, rubOut, type Stroke } from "../lib/board.ts";
import type { Server } from "../lib/types.ts";

const line = (id: string, by: string | undefined, y = 0.5): Stroke => ({ id, color: "#fff", size: 4, pts: [0.1, y, 0.9, y], by });
const board = () => [line("a1", "ana", 0.2), line("b1", "beto", 0.5), line("b2", "beto", 0.8), line("old", undefined, 0.9)];

function server(): Server {
  const m = (id: string, role: "owner" | "admin" | "member", roles: string[] = []) => ({ user: { id } as never, role, nickname: "", roles, joined_at: "" });
  return {
    id: "s", name: "", description: "", owner_id: "dono", accent: "", hall_threshold: 3, welcome_lines: [], icon: null, banner: null,
    channels: [], sounds: [], emojis: [],
    roles: [{ id: "r-lider", name: "Líder", color: "", position: 1, perms: ["moderar_voz"] }, { id: "r-dj", name: "DJ", color: "", position: 2, perms: ["dj"] }],
    everyone_perms: [],
    members: [m("dono", "owner"), m("adm", "admin"), m("lider", "member", ["r-lider"]), m("dj", "member", ["r-dj"]), m("ana", "member")],
  };
}

test("quem lidera a call: dono, admin e cargo com Moderar call; mais ninguém", () => {
  const s = server();
  assert.equal(leadsBoard(s, "dono"), true);
  assert.equal(leadsBoard(s, "adm"), true);
  assert.equal(leadsBoard(s, "lider"), true);
  assert.equal(leadsBoard(s, "dj"), false);
  assert.equal(leadsBoard(s, "ana"), false);
  assert.equal(leadsBoard(s, "estranho"), false);
  assert.equal(leadsBoard(undefined, "ana"), false, "conversa privada não tem líder");
  assert.equal(leadsBoard({ ...s, everyone_perms: ["moderar_voz"] }, "ana"), true, "@todos com Moderar call");
});

test("borracha pega só os seus traços perto do ponteiro", () => {
  assert.deepEqual(hitByEraser(board(), 0.5, 0.5, 0.02, "beto", false), ["b1"]);
  assert.deepEqual(hitByEraser(board(), 0.5, 0.2, 0.02, "beto", false), [], "o traço da Ana não é dele");
  assert.deepEqual(hitByEraser(board(), 0.5, 0.2, 0.02, "lider", true), ["a1"], "quem lidera apaga de qualquer um");
  assert.deepEqual(hitByEraser(board(), 0.5, 0.35, 0.02, "beto", false), [], "longe de tudo");
  assert.deepEqual(hitByEraser(board(), 0.5, 0.9, 0.02, "ana", false), [], "traço antigo (sem dono) só quem lidera");
});

test("apagar: quem recebe só aceita o que o remetente pode apagar", () => {
  const ids = (s: Stroke[]) => s.map((x) => x.id);
  assert.deepEqual(ids(applyBoardMsg(board(), { type: "erase", ids: ["b1"] }, "beto", false)), ["a1", "b2", "old"]);
  assert.deepEqual(ids(applyBoardMsg(board(), { type: "erase", ids: ["a1", "b1"] }, "beto", false)), ["a1", "b2", "old"], "o da Ana fica");
  assert.deepEqual(ids(applyBoardMsg(board(), { type: "erase", ids: ["a1"] }, "lider", true)), ["b1", "b2", "old"]);
});

test("limpar: o meu tira só os meus; tudo só de quem lidera", () => {
  const ids = (s: Stroke[]) => s.map((x) => x.id);
  assert.deepEqual(ids(applyBoardMsg(board(), { type: "clear", scope: "mine" }, "beto", false)), ["a1", "old"]);
  assert.deepEqual(ids(applyBoardMsg(board(), { type: "clear", scope: "all" }, "beto", false)), ["a1", "old"], "pediu tudo sem liderar: só o dele");
  assert.deepEqual(ids(applyBoardMsg(board(), { type: "clear" }, "ana", false)), ["b1", "b2", "old"], "versão antiga mandando 'limpar': só o de quem mandou");
  assert.deepEqual(applyBoardMsg(board(), { type: "clear", scope: "all" }, "adm", true), []);
});

test("traço novo entra uma vez só e lixo é ignorado", () => {
  const b = board();
  assert.equal(applyBoardMsg(b, { type: "stroke", stroke: line("a1", "ana") }, "ana", false), b);
  assert.equal(applyBoardMsg(b, { type: "stroke", stroke: line("n1", "ana") }, "ana", false).length, 5);
  assert.equal(applyBoardMsg(b, { type: "stroke", stroke: { id: 3 } as never }, "ana", false), b);
});

test("traço que chega fica com quem mandou, mesmo se vier com outro dono escrito", () => {
  const got = applyBoardMsg([], { type: "stroke", stroke: line("f1", "ana") }, "beto", false);
  assert.equal(got[0].by, "beto", "não dá para desenhar como a Ana");
  assert.deepEqual(applyBoardMsg(got, { type: "clear", scope: "mine" }, "ana", false).map((s) => s.id), ["f1"], "a Ana não apaga o traço do Beto");
});

test("borracha corta só o pedaço que passou por cima, e o resto do traço fica", () => {
  const before = [line("b1", "beto", 0.5)]; // de 0.1 a 0.9 na altura 0.5
  const after = rubOut(before, [0.5, 0.45, 0.5, 0.55], 0.02, "beto", false);
  assert.equal(after.length, 2, "o traço vira dois pedaços");
  assert.deepEqual(after.map((s) => s.id), ["b1~0", "b1~1"]);
  assert.ok(after.every((s) => s.by === "beto" && s.color === "#fff"), "os pedaços continuam do mesmo dono e cor");
  const left = after[0].pts, right = after[1].pts;
  assert.ok(Math.abs(left[0] - 0.1) < 1e-9 && left[left.length - 2] < 0.48, "o pedaço da esquerda vai até perto da borracha");
  assert.ok(right[0] > 0.52 && Math.abs(right[right.length - 2] - 0.9) < 1e-9, "o da direita começa depois dela");
});

test("borracha arrastada corta o caminho todo, sem pular pedaço", () => {
  const after = rubOut([line("b1", "beto", 0.5)], [0.2, 0.5, 0.8, 0.5], 0.01, "beto", false);
  // sobra só a pontinha de cada lado
  assert.equal(after.length, 2);
  assert.ok(after[0].pts.every((v, i) => i % 2 === 1 || v < 0.2));
  assert.ok(after[1].pts.every((v, i) => i % 2 === 1 || v > 0.8));
});

test("borracha longe de tudo não muda nada; e não mexe no traço dos outros", () => {
  const b = board();
  assert.equal(rubOut(b, [0.5, 0.35, 0.5, 0.35], 0.02, "beto", false), b, "longe de tudo: o mesmo quadro");
  assert.equal(rubOut(b, [0.5, 0.2, 0.5, 0.2], 0.02, "beto", false), b, "o traço da Ana não é dele");
  const led = rubOut(b, [0.5, 0.2, 0.5, 0.2], 0.02, "lider", true);
  assert.deepEqual(led.filter((s) => s.id.startsWith("a1")).map((s) => s.id), ["a1~0", "a1~1"], "quem lidera corta o de qualquer um");
});

test("todo mundo que recebe o mesmo corte chega no mesmo quadro (e mensagem estranha é ignorada)", () => {
  const msg = { type: "rub" as const, path: [0.5, 0.5, 0.5, 0.5], r: 0.02 };
  assert.deepEqual(applyBoardMsg(board(), msg, "beto", false), applyBoardMsg(board(), msg, "beto", false));
  const b = board();
  assert.equal(applyBoardMsg(b, { type: "rub", path: [Number.NaN, 0.5], r: 0.02 }, "beto", false), b);
  assert.equal(applyBoardMsg(b, { type: "rub", path: [0.5, 0.5], r: 0 }, "beto", false), b);
  const huge = applyBoardMsg(b, { type: "rub", path: [0.5, 0.5], r: 999 }, "lider", true);
  assert.ok(huge.length > 0, "raio gigante é limitado: não vira um Limpar tudo disfarçado");
});

// ------------------------------------------------------------------ entradas extremas (ninguém trava o quadro dos outros)
test("traço recebido com coordenada gigante, NaN ou tamanho absurdo é corrigido ou descartado", () => {
  const huge = cleanStroke({ id: "x", color: "#fff", size: 4, pts: [0, 0, 1e9, -1e9] });
  assert.deepEqual(huge?.pts, [0, 0, 1, 0], "coordenadas presas entre 0 e 1");
  assert.equal(cleanStroke({ id: "x", color: "#fff", size: 4, pts: [0, Number.NaN] }), null);
  assert.equal(cleanStroke({ id: "x", color: "#fff", size: 4, pts: [0, "1"] }), null);
  assert.equal(cleanStroke({ id: "x", color: "#fff", size: 4, pts: [0, 0, 1] }), null, "número ímpar de coordenadas");
  assert.equal(cleanStroke({ id: "x", color: "#fff", size: 4, pts: new Array(LIMITS.points * 2 + 2).fill(0.5) }), null, "pontos demais");
  assert.equal(cleanStroke({ id: "x", color: "url(javascript:1)", size: 1e9, pts: [0.5, 0.5] })?.size, 40);
  assert.equal(cleanStroke({ id: "x", color: "url(javascript:1)", size: 4, pts: [0.5, 0.5] })?.color, "#ffffff");
  assert.equal(cleanStroke(null), null);
  const b = board();
  assert.equal(applyBoardMsg(b, { type: "stroke", stroke: { id: "z", color: "#fff", size: 4, pts: [Number.POSITIVE_INFINITY, 0] } }, "ana", false), b);
});

test("a borracha num traço malicioso termina rápido (antes: ~333 bilhões de passos)", () => {
  // traço que chegou de uma versão sem a conferência, com coordenadas enormes
  const evil: Stroke = { id: "evil", color: "#fff", size: 4, pts: [0, 0, 1e9, 1e9, -1e9, 1e9], by: "ana" };
  const t = performance.now();
  const after = rubOut([evil], [0, 0, 0, 0], 0.05, "ana", false);
  assert.ok(performance.now() - t < 200, "precisa terminar em menos de 200 ms");
  assert.deepEqual(after, [evil], "longo demais para cortar: fica inteiro (não some pela metade)");
});

test("borracha com caminho extremo, num quadro cheio, respeita o orçamento", () => {
  const full: Stroke[] = [];
  for (let i = 0; i < LIMITS.strokes; i++) {
    const pts: number[] = [];
    for (let k = 0; k < 200; k++) pts.push(k / 200, (i % 100) / 100);
    full.push({ id: `s${i}`, color: "#fff", size: 40, pts, by: "ana" });
  }
  const t = performance.now();
  const after = rubOut(full, [-1e12, -1e12, 1e12, 1e12], 1e9, "lider", true);
  assert.ok(performance.now() - t < 1000, "precisa terminar em menos de 1 s");
  assert.ok(after.length > 0, "o raio é limitado: não vira um Limpar tudo");
});

test("o quadro não cresce sem fim", () => {
  let b: Stroke[] = [];
  for (let i = 0; i < LIMITS.strokes + 50; i++) b = applyBoardMsg(b, { type: "stroke", stroke: { id: `t${i}`, color: "#fff", size: 4, pts: [0.5, 0.5] } }, "ana", false);
  assert.equal(b.length, LIMITS.strokes);
});


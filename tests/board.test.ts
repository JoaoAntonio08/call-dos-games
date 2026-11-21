import assert from "node:assert/strict";
import test from "node:test";

import { applyBoardMsg, hitByEraser, leadsBoard, type Stroke } from "../lib/board.ts";
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

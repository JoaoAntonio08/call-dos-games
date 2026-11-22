// Regras da lousa da call: cada traço tem dono; a borracha e o "Limpar" só mexem no que é seu.
// Quem lidera a call (dono, admins e cargos com "Moderar call") pode apagar de todo mundo.
// Tudo passa pelo canal de dados do LiveKit, então QUEM RECEBE confere quem mandou antes de apagar.
import type { Perm, Server } from "./types";

export interface Stroke {
  id: string;
  color: string;
  size: number;
  pts: number[]; // x0,y0,x1,y1… normalizados 0..1
  /** id de quem desenhou (traços de versões antigas não têm) */
  by?: string;
}

export type BoardMsg =
  | { type: "stroke"; stroke: Stroke }
  | { type: "erase"; ids: string[] }
  | { type: "clear"; scope?: "mine" | "all" };

/** Lidera a call: dono, admin, ou cargo (ou @todos) com "Moderar call". Em conversa privada ninguém. */
export function leadsBoard(server: Server | undefined, userId: string | undefined): boolean {
  if (!server || !userId) return false;
  const m = server.members.find((x) => x.user.id === userId);
  if (!m) return false;
  if (m.role === "owner" || m.role === "admin") return true;
  const perm: Perm = "moderar_voz";
  if (server.everyone_perms?.includes(perm)) return true;
  const roles = new Map((server.roles ?? []).map((r) => [r.id, r]));
  return (m.roles ?? []).some((id) => roles.get(id)?.perms.includes(perm));
}

/** Pode apagar esse traço? O próprio sempre; o dos outros só quem lidera. */
export function canErase(s: Stroke, userId: string, leads: boolean): boolean {
  return leads || (!!s.by && s.by === userId);
}

/** Distância de um ponto (x, y) até o traço, nas mesmas unidades 0..1. */
export function distanceTo(s: Stroke, x: number, y: number): number {
  const p = s.pts;
  if (p.length < 2) return Infinity;
  if (p.length === 2) return Math.hypot(x - p[0], y - p[1]);
  let best = Infinity;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

/** Traços que a borracha pega nesse ponto (raio em unidades 0..1, mais a grossura do traço). */
export function hitByEraser(strokes: Stroke[], x: number, y: number, radius: number, userId: string, leads: boolean): string[] {
  return strokes.filter((s) => canErase(s, userId, leads) && distanceTo(s, x, y) <= radius + s.size / 2000).map((s) => s.id);
}

/**
 * Aplica uma mensagem da lousa que chegou de `sender`.
 * Quem recebe é quem garante a regra: apagar o traço de outra pessoa só vale se o remetente lidera.
 */
export function applyBoardMsg(strokes: Stroke[], msg: BoardMsg, sender: string, senderLeads: boolean): Stroke[] {
  if (msg.type === "stroke") {
    const s = msg.stroke;
    if (!s || typeof s.id !== "string" || !Array.isArray(s.pts)) return strokes;
    // o dono é quem mandou de verdade, não o que veio escrito no traço (senão dava para desenhar "como" outra pessoa)
    return strokes.some((x) => x.id === s.id) ? strokes : [...strokes, { ...s, by: sender }];
  }
  if (msg.type === "erase") {
    const ids = new Set(Array.isArray(msg.ids) ? msg.ids.slice(0, 500) : []);
    const next = strokes.filter((s) => !(ids.has(s.id) && canErase(s, sender, senderLeads)));
    return next.length === strokes.length ? strokes : next;
  }
  if (msg.type === "clear") {
    // "tudo" só de quem lidera; qualquer outro "limpar" (inclusive de versões antigas) apaga só o de quem mandou
    if (msg.scope === "all" && senderLeads) return strokes.length ? [] : strokes;
    const next = strokes.filter((s) => s.by !== sender);
    return next.length === strokes.length ? strokes : next;
  }
  return strokes;
}

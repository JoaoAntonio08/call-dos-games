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
  /** borracha de verdade: corta só o pedaço dos traços que fica debaixo do caminho dela (x0,y0,x1,y1) */
  | { type: "rub"; path: number[]; r: number }
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

/** Distância do ponto (x, y) ao segmento a→b. */
function toSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

const STEP = 0.003; // os traços são cortados nessa resolução (mesma distância mínima entre pontos ao desenhar)
const MAX_RUB_RADIUS = 0.1;
/** limites de tudo que chega pela rede: ninguém trava o quadro dos outros com traço ou borracha exagerados */
export const LIMITS = {
  points: 1200, // pares x,y por traço (o mesmo limite de quem desenha)
  strokes: 3000, // traços no quadro
  densify: 4000, // pontos (x,y) de um traço depois de adensado
  rubBudget: 40_000, // pontos analisados por passada de borracha, somando todos os traços
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Traço que veio de outra pessoa, conferido: só números finitos entre 0 e 1, tamanho e cor normais. null = descarta. */
export function cleanStroke(raw: unknown): Stroke | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== "string" || !s.id || s.id.length > 512 || !Array.isArray(s.pts)) return null;
  if (s.pts.length < 2 || s.pts.length % 2 !== 0 || s.pts.length > LIMITS.points * 2) return null;
  const pts: number[] = [];
  for (const v of s.pts) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    pts.push(clamp01(v));
  }
  const size = typeof s.size === "number" && Number.isFinite(s.size) ? Math.max(1, Math.min(40, s.size)) : 4;
  const color = typeof s.color === "string" && /^#[0-9a-f]{3,8}$/i.test(s.color) ? s.color : "#ffffff";
  return { id: s.id, color, size, pts };
}

/**
 * Pontos do traço com no máximo STEP entre eles (para o corte não pular um pedaço). null se precisaria
 * de mais de `cap` pontos: aí o traço fica inteiro (cortar uma versão pela metade sumiria com o resto).
 */
function densify(p: number[], cap: number): number[] | null {
  if (p.length < 4) return p.slice(0, 2);
  const out = [p[0], p[1]];
  for (let i = 2; i + 1 < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
    // confere antes de gerar: nunca passa do limite, nem dentro de um segmento
    if (out.length / 2 + n > cap) return null;
    for (let k = 1; k <= n; k++) out.push(Math.round((ax + ((bx - ax) * k) / n) * 10000) / 10000, Math.round((ay + ((by - ay) * k) / n) * 10000) / 10000);
  }
  return out;
}

/**
 * Passa a borracha pelo caminho `path` (pares x,y): o que fica debaixo dela some e o resto do traço
 * vira pedaços separados (ids `<id>~0`, `<id>~1`…). É determinístico: todo mundo que recebe a mesma
 * mensagem chega no mesmo quadro. Só mexe no que `sender` pode apagar.
 */
export function rubOut(strokes: Stroke[], path: number[], radius: number, sender: string, leads: boolean): Stroke[] {
  const r = Math.max(0, Math.min(MAX_RUB_RADIUS, Number(radius) || 0));
  const eraser = (Array.isArray(path) ? path.slice(0, 4) : []).map(Number);
  if (r === 0 || eraser.length < 2 || eraser.some((v) => !Number.isFinite(v))) return strokes;
  const [ax, ay] = eraser.map(clamp01);
  const [bx, by] = eraser.length >= 4 ? [clamp01(eraser[2]), clamp01(eraser[3])] : [ax, ay];
  // orçamento por passada: gasto na mesma ordem por todo mundo, então todos chegam no mesmo quadro
  let budget = LIMITS.rubBudget;
  const under = (x: number, y: number, reach: number) => toSegment(x, y, ax, ay, bx, by) <= reach;
  let changed = false;
  const out: Stroke[] = [];
  for (const s of strokes) {
    const reach = r + s.size / 2000;
    if (budget <= 0 || !canErase(s, sender, leads) || Math.min(distanceTo(s, ax, ay), distanceTo(s, bx, by), distanceTo(s, (ax + bx) / 2, (ay + by) / 2)) > reach + Math.hypot(bx - ax, by - ay) / 2) {
      out.push(s);
      continue;
    }
    const cap = Math.min(LIMITS.densify, budget);
    const pts = densify(s.pts, cap);
    // desconta o que custou (ou o teto, se passou dele): a conta é a mesma em todo mundo
    budget -= pts ? pts.length / 2 : cap;
    if (!pts) {
      out.push(s);
      continue;
    }
    if (pts.length === 2) {
      // um ponto só: ou some inteiro ou fica
      if (under(pts[0], pts[1], reach)) changed = true;
      else out.push(s);
      continue;
    }
    const parts: number[][] = [];
    let run: number[] = [];
    let cut = false;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      if (under(pts[i], pts[i + 1], reach)) {
        cut = true;
        if (run.length >= 4) parts.push(run);
        run = [];
      } else run.push(pts[i], pts[i + 1]);
    }
    if (run.length >= 4) parts.push(run);
    if (!cut) {
      out.push(s);
      continue;
    }
    changed = true;
    parts.forEach((pts, k) => out.push({ ...s, id: `${s.id}~${k}`, pts }));
  }
  return changed ? out : strokes;
}

/**
 * Aplica uma mensagem da lousa que chegou de `sender`.
 * Quem recebe é quem garante a regra: apagar o traço de outra pessoa só vale se o remetente lidera.
 */
export function applyBoardMsg(strokes: Stroke[], msg: BoardMsg, sender: string, senderLeads: boolean): Stroke[] {
  if (msg.type === "stroke") {
    const s = cleanStroke(msg.stroke);
    if (!s || strokes.length >= LIMITS.strokes) return strokes;
    // o dono é quem mandou de verdade, não o que veio escrito no traço (senão dava para desenhar "como" outra pessoa)
    return strokes.some((x) => x.id === s.id) ? strokes : [...strokes, { ...s, by: sender }];
  }
  if (msg.type === "erase") {
    const ids = new Set(Array.isArray(msg.ids) ? msg.ids.slice(0, 500) : []);
    const next = strokes.filter((s) => !(ids.has(s.id) && canErase(s, sender, senderLeads)));
    return next.length === strokes.length ? strokes : next;
  }
  if (msg.type === "rub") {
    return rubOut(strokes, msg.path, msg.r, sender, senderLeads);
  }
  if (msg.type === "clear") {
    // "tudo" só de quem lidera; qualquer outro "limpar" (inclusive de versões antigas) apaga só o de quem mandou
    if (msg.scope === "all" && senderLeads) return strokes.length ? [] : strokes;
    const next = strokes.filter((s) => s.by !== sender);
    return next.length === strokes.length ? strokes : next;
  }
  return strokes;
}

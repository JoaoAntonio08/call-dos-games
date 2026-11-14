/* Datas e tamanhos em pt-BR. */

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "hoje às 21:04", "ontem às 09:12", "12/11/2026 21:04" */
export function stampOf(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `hoje às ${timeOf(iso)}`;
  if (sameDay(d, y)) return `ontem às ${timeOf(iso)}`;
  return `${d.toLocaleDateString("pt-BR")} ${timeOf(iso)}`;
}

/** Separador de dia no chat: "sexta-feira, 13 de novembro" */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Hoje";
  if (sameDay(d, y)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function isSameDay(a: string, b: string) {
  return sameDay(new Date(a), new Date(b));
}

export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function sinceOf(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
}

/** "há 12 min" para quem está na call. */
export function durationOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "há 3 dias", "ontem", "agora". */
export function agoOf(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d === 1) return "ontem";
  if (d < 30) return `há ${d} dias`;
  return sinceOf(iso);
}

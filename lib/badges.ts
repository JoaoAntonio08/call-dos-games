import type { Flair, User } from "./types";

/** Insígnias que cada pessoa escolhe para o perfil (a API aceita só estes ids, até 4). */
export const BADGES: { id: string; emoji: string; label: string }[] = [
  { id: "gamer", emoji: "🎮", label: "Gamer" },
  { id: "otaku", emoji: "🍙", label: "Otaku" },
  { id: "dj", emoji: "🎧", label: "DJ da call" },
  { id: "artista", emoji: "🎨", label: "Artista" },
  { id: "streamer", emoji: "📺", label: "Streamer" },
  { id: "coruja", emoji: "🌙", label: "Coruja" },
  { id: "cafe", emoji: "☕", label: "Movido a café" },
  { id: "pizza", emoji: "🍕", label: "Fã de pizza" },
  { id: "boss", emoji: "💀", label: "Mata boss" },
  { id: "sono", emoji: "😴", label: "Dorme na call" },
  { id: "carry", emoji: "🏆", label: "Carrega o time" },
  { id: "noob", emoji: "🐣", label: "Café com leite" },
  { id: "cozinha", emoji: "🍳", label: "Na cozinha" },
  { id: "cinema", emoji: "🎬", label: "Maratona de filme" },
  { id: "leitura", emoji: "📚", label: "Leitura em dia" },
  { id: "pet", emoji: "🐶", label: "Tutor de pet" },
];
export const MAX_BADGES = 4;

/** Quem criou a conta no primeiro ano ganha a insígnia de pioneiro, sem precisar escolher. */
const PIONEER = { id: "pioneiro", emoji: "🚀", label: "Pioneiro da turma" };
const PIONEER_UNTIL = Date.parse("2027-01-01T00:00:00Z");

export function badgesOf(u: Pick<User, "badges" | "created_at">) {
  const out = (u.badges ?? []).map((id) => BADGES.find((b) => b.id === id)).filter((b): b is (typeof BADGES)[number] => !!b);
  if (Date.parse(u.created_at) < PIONEER_UNTIL) out.unshift(PIONEER);
  return out;
}

/** Cor do nome no chat e na lista: a escolhida, ou um tom da cor do perfil. */
export function nameColorOf(u: Pick<User, "name_color" | "accent"> | null | undefined, mix = 70) {
  if (!u) return undefined;
  if (u.name_color) return u.name_color;
  return `color-mix(in srgb, ${u.accent || "#5865f2"} ${mix}%, var(--color-oat))`;
}

/** Fundo do cartão de perfil: degradê das duas cores do tema, ou nada (cartão padrão). */
export function themeBgOf(u: Pick<User, "theme">) {
  const t = u.theme ?? [];
  if (t.length !== 2) return undefined;
  return `linear-gradient(180deg, ${t[0]} 0%, ${t[1]} 100%)`;
}

/* ------------------------------------------------------------------ */
/* Enfeites de conquista                                                */
/* ------------------------------------------------------------------ */

/** Placas da vitrine do perfil. "holo" brilha e muda de cor com o mouse. */
export const PLATES: Record<string, { title: string; sub: string; tone: "prata" | "ouro" | "holo"; icon: "crown" | "radio" | "users" }> = {
  live: { title: "Na tela", sub: "1 h transmitindo", tone: "prata", icon: "radio" },
  streamer: { title: "Streamer", sub: "25 h transmitindo", tone: "holo", icon: "radio" },
  crowd: { title: "Plateia", sub: "3 h assistindo a tela da turma", tone: "prata", icon: "users" },
  crowd_holo: { title: "Plateia fiel", sub: "25 h assistindo a tela da turma", tone: "holo", icon: "users" },
  founder: { title: "Fundador", sub: "Criou um servidor", tone: "ouro", icon: "crown" },
  founder_gold: { title: "Fundador", sub: "Criou três servidores", tone: "holo", icon: "crown" },
};

/** O que dá para escolher em cada lugar do perfil (o id da conquista é "lugar:valor"). */
export const FLAIR_SLOTS: { slot: keyof Flair; title: string; options: { value: string; label: string }[] }[] = [
  { slot: "name", title: "Nome", options: [{ value: "gradient", label: "Degradê" }, { value: "rgb", label: "RGB" }] },
  { slot: "ring", title: "Aro da foto", options: [{ value: "pulse", label: "Pulsando" }, { value: "live", label: "Ao vivo" }] },
  { slot: "banner", title: "Banner", options: [{ value: "shine", label: "Brilho" }] },
  {
    slot: "plate",
    title: "Placa",
    options: Object.entries(PLATES).map(([value, p]) => ({ value, label: p.tone === "holo" ? `${p.title} holográfica` : p.title })),
  },
];

/** Classe e estilo do nome com o efeito escolhido (degradê usa a cor do nome ou do perfil). */
export function nameStyle(u: Pick<User, "name_color" | "accent" | "flair"> | null | undefined, mix = 70): { className: string; style: React.CSSProperties } {
  const fx = u?.flair?.name;
  const color = nameColorOf(u, mix);
  if (fx === "rgb") return { className: "fx-name-rgb", style: { color } };
  if (fx === "gradient") return { className: "fx-name-gradient", style: { color, ["--fx-a" as string]: u?.name_color || u?.accent || "#5865f2" } };
  return { className: "", style: { color } };
}

export function ringClass(u: Pick<User, "flair"> | null | undefined) {
  const fx = u?.flair?.ring;
  return fx === "pulse" ? "fx-ring-pulse" : fx === "live" ? "fx-ring-live" : "";
}

export function bannerClass(u: Pick<User, "flair"> | null | undefined) {
  return u?.flair?.banner === "shine" ? "fx-banner-shine" : "";
}

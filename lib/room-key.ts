/** Normaliza a chave digitada: minúsculas, sem acento, só letras, números e hífen. */
export function normalizeKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Nome da sala no LiveKit a partir da chave. Vazio quando a chave não serve. */
export function roomNameFromKey(raw: string): string {
  const key = normalizeKey(raw);
  return key.length >= 3 ? `sala-${key}` : "";
}

const WORDS = [
  "sakura", "ramen", "kitsune", "tanuki", "mochi", "ninja", "ronin", "sensei",
  "onigiri", "tsuki", "kaze", "hoshi", "yuki", "sora", "kumo", "taiyo",
];

/** Chave aleatória fácil de ditar na call, por exemplo "kitsune-mochi-42". */
export function randomKey(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const a = pick();
  let b = pick();
  while (b === a) b = pick();
  return `${a}-${b}-${Math.floor(10 + Math.random() * 90)}`;
}

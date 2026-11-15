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
    .slice(0, 64);
}

/** Nome da sala no LiveKit a partir da chave. Vazio quando a chave não serve. */
export function roomNameFromKey(raw: string): string {
  const key = normalizeKey(raw);
  return /^[a-z0-9][a-z0-9-]{19,63}$/.test(key) ? `guest-${key}` : "";
}

/** Chave aleatória de 128 bits. Compartilhe o link em vez de ditar a chave. */
export function randomKey(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

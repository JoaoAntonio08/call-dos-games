/* Preferências locais do navegador. Tudo em try/catch: o armazenamento pode estar bloqueado. */

const NAME = "sala:nome";
const AUTO = "sala:autojoin";
const GLASS = "sala:vidro";
const SHARE = "sala:tela";

function get(store: "local" | "session", k: string): string | null {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(k);
  } catch {
    return null;
  }
}
function put(store: "local" | "session", k: string, v: string | null) {
  try {
    const s = store === "local" ? localStorage : sessionStorage;
    if (v === null) s.removeItem(k);
    else s.setItem(k, v);
  } catch {
    /* sem armazenamento, segue sem lembrar */
  }
}

export const loadName = () => get("local", NAME) ?? "";
export const saveName = (n: string) => put("local", NAME, n);

/** O lobby marca a sala para entrar direto (o clique em "Entrar" já liberou o áudio). */
export const setAutoJoin = (key: string) => put("session", AUTO, key);
export function takeAutoJoin(key: string): boolean {
  const v = get("session", AUTO);
  put("session", AUTO, null);
  return v === key;
}

export function loadJSON<T>(k: "glass" | "share", fallback: T): T {
  const raw = get("local", k === "glass" ? GLASS : SHARE);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
export const saveJSON = (k: "glass" | "share", v: unknown) => put("local", k === "glass" ? GLASS : SHARE, JSON.stringify(v));

/* Cliente da API (FastAPI). O token fica no localStorage e vai no cabeçalho Authorization. */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/^\uFEFF/, "").trim().replace(/\/$/, "");
/** Em produção, o app com contas só funciona com o endereço da API definido no build (NEXT_PUBLIC_API_URL). */
export const API_READY = process.env.NODE_ENV !== "production" || !!process.env.NEXT_PUBLIC_API_URL;
export const GATEWAY_URL = API_URL.replace(/^http/, "ws") + "/gateway";

const TOKEN_KEY = "cdg:token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sem armazenamento: a sessão dura só esta aba */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Opts = { method?: string; json?: unknown; form?: FormData; signal?: AbortSignal };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) body = opts.form;

  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: opts.signal, credentials: "include" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Sem conexão com o servidor. Ele pode estar desligado.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event("cdg:logout"));
    }
    throw new ApiError(data.error || `Algo deu errado (${res.status}).`, res.status);
  }
  return data as T;
}

/** Envia um arquivo. */
export function upload<T = unknown>(path: string, file: File, extra: Record<string, string> = {}, method = "POST") {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return api<T>(path, { method, form });
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Algo deu errado.";
}

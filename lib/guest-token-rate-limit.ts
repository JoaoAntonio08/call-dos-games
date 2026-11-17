const attempts = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 15;

export function guestTokenRateLimited(id: string, now = Date.now()): boolean {
  if (attempts.size > 5_000) {
    for (const [key, values] of attempts) {
      if (!values.some((at) => now - at < WINDOW_MS)) attempts.delete(key);
    }
    if (attempts.size > 5_000 && !attempts.has(id)) return true;
  }

  const recent = (attempts.get(id) || []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(id, recent);
    return true;
  }
  recent.push(now);
  attempts.set(id, recent);
  return false;
}

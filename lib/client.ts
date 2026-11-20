import type { DictKey } from "./dictionaries";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

/** The server finishes within 60 s; the client gives up a little later so the UI never hangs. */
const CLIENT_TIMEOUT_MS = 65_000;

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    throw new ApiError(name === "TimeoutError" ? "timeout" : "network", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error?.code ?? "unknown", res.status);
  if (data === null) throw new ApiError("bad_response", res.status);
  return data as T;
}

export function errorKey(e: unknown): DictKey {
  if (e instanceof ApiError) {
    if (e.code === "rate_limit") return "errors.rateLimit";
    if (e.code === "no_key") return "errors.noKey";
    // AI overloaded, all models failed, platform timeout (504) or our own timeout.
    if (e.code === "ai_busy" || e.code === "timeout" || e.status === 503 || e.status === 504) return "errors.busy";
  }
  return "errors.generic";
}

/** Small string hash used to invalidate cached translations when the source changes. */
export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function storageGet<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — ignore */
  }
}

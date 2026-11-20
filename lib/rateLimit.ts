import "server-only";

/**
 * Simple in-memory rate limiter (per server instance).
 * Good enough for an MVP; for multi-instance production use Redis (e.g. Upstash).
 */
type Bucket = { hits: number[]; dayStart: number; dayCount: number };

const store = new Map<string, Bucket>();
const MINUTE = 60_000;
const DAY = 86_400_000;

export type LimitResult = { ok: true } | { ok: false; retryAfter: number };

export function rateLimit(key: string, perMinute: number, perDay: number): LimitResult {
  const now = Date.now();
  let b = store.get(key);
  if (!b) {
    b = { hits: [], dayStart: now, dayCount: 0 };
    store.set(key, b);
  }
  b.hits = b.hits.filter((t) => now - t < MINUTE);
  if (now - b.dayStart > DAY) {
    b.dayStart = now;
    b.dayCount = 0;
  }
  if (b.hits.length >= perMinute) {
    return { ok: false, retryAfter: Math.ceil((MINUTE - (now - b.hits[0])) / 1000) };
  }
  if (b.dayCount >= perDay) {
    return { ok: false, retryAfter: Math.ceil((DAY - (now - b.dayStart)) / 1000) };
  }
  b.hits.push(now);
  b.dayCount++;

  // Prevent unbounded growth.
  if (store.size > 10_000) {
    for (const [k, v] of store) {
      if (now - v.dayStart > DAY) store.delete(k);
    }
  }
  return { ok: true };
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

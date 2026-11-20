import "server-only";
import { getClientIp, rateLimit } from "./rateLimit";
import { MissingKeyError } from "./gemini";
import { AiBusyError } from "./aiRetry";

export type ApiErrorCode = "rate_limit" | "no_key" | "bad_request" | "ai_busy" | "ai_error";

export function apiError(status: number, code: ApiErrorCode, message: string, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

/** Returns a 429 response if the client exceeded the limit, otherwise null. */
export function checkLimit(req: Request, route: string, perMinute: number, perDay: number) {
  const r = rateLimit(`${route}:${getClientIp(req)}`, perMinute, perDay);
  if (r.ok) return null;
  return apiError(429, "rate_limit", "Too many requests", { "Retry-After": String(r.retryAfter) });
}

export function handleAiError(e: unknown) {
  if (e instanceof MissingKeyError) {
    return apiError(503, "no_key", e.message);
  }
  if (e instanceof AiBusyError) {
    console.error("All Gemini models failed:", e.lastError);
    return apiError(503, "ai_busy", "AI is busy, try again in a few seconds", { "Retry-After": "5" });
  }
  console.error(e);
  return apiError(502, "ai_error", "AI request failed");
}

/** Allowed characters for a language name typed by the user. */
export const LANGUAGE_RE = /^[\p{L}\p{M}\s\-()'’.]{1,40}$/u;

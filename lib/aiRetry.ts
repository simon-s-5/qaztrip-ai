/**
 * Retry + model fallback for AI calls. Pure logic (no SDK, no secrets) so it is unit-tested:
 * see tests/aiRetry.test.mts.
 *
 * For each model in order (primary first, then fallbacks):
 *  - 429 / 500 / 503: retry the same model up to `maxAttempts` times with exponential backoff
 *    (base, 2×base, … plus a little jitter), then move to the next model;
 *  - timeout, 404 (model not available), empty or invalid output: move to the next model;
 *  - other 4xx (bad request, invalid key): stop immediately — retrying would not help.
 * The whole call has a time budget, so the user never waits forever.
 * If every model fails, an AiBusyError is thrown (shown to the user as "AI is busy, try again").
 */

export class AiBusyError extends Error {
  lastError: unknown;
  constructor(lastError?: unknown) {
    super("AI is busy");
    this.name = "AiBusyError";
    this.lastError = lastError;
  }
}

export type RetryOptions = {
  /** Total time budget for all attempts (ms). */
  budgetMs: number;
  /** Max attempts per model for retryable errors (default 3). */
  maxAttempts?: number;
  /** First backoff delay (ms), doubled each retry (default 1000). */
  baseDelayMs?: number;
  /** Timeout of a single attempt (ms), capped by the remaining budget (default 25000). */
  attemptTimeoutMs?: number;
  onRetry?: (info: { model: string; attempt: number; status?: number; delayMs: number }) => void;
  onFallback?: (info: { from: string; to: string; reason: string }) => void;
  sleep?: (ms: number) => Promise<void>;
};

export type RetryResult<T> = { value: T; model: string; fallback: boolean; attempts: number };

const RETRYABLE = new Set([429, 500, 503]);
/** Do not start an attempt with less time than this left. */
const MIN_ATTEMPT_MS = 1500;

export function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

export function isTimeout(e: unknown): boolean {
  const name = (e as { name?: unknown })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runWithFallback<T>(
  models: string[],
  call: (model: string, signal: AbortSignal) => Promise<T>,
  opts: RetryOptions,
): Promise<RetryResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const attemptTimeout = opts.attemptTimeoutMs ?? 25_000;
  const sleep = opts.sleep ?? defaultSleep;
  const deadline = Date.now() + opts.budgetMs;
  const list = [...new Set(models.filter(Boolean))];
  let lastError: unknown;
  let attempts = 0;

  for (let i = 0; i < list.length; i++) {
    const model = list[i];
    let reason = "error";

    for (let a = 0; a < maxAttempts; a++) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ATTEMPT_MS) throw new AiBusyError(lastError);
      attempts++;
      try {
        const value = await call(model, AbortSignal.timeout(Math.min(attemptTimeout, remaining)));
        return { value, model, fallback: i > 0, attempts };
      } catch (e) {
        lastError = e;
        if (isTimeout(e)) {
          reason = "timeout";
          break;
        }
        const s = statusOf(e);
        if (s !== undefined && RETRYABLE.has(s)) {
          reason = String(s);
          if (a === maxAttempts - 1) break;
          const delayMs = Math.round(base * 2 ** a + Math.random() * base * 0.3);
          if (Date.now() + delayMs > deadline - MIN_ATTEMPT_MS) break;
          opts.onRetry?.({ model, attempt: a + 1, status: s, delayMs });
          await sleep(delayMs);
          continue;
        }
        if (s === 404) {
          reason = "404";
          break;
        }
        if (s !== undefined && s >= 400 && s < 500) throw e; // bad request / invalid key
        reason = "invalid output";
        break; // network error, empty or malformed answer: try the next model
      }
    }

    if (i < list.length - 1) opts.onFallback?.({ from: model, to: list[i + 1], reason });
  }
  throw new AiBusyError(lastError);
}

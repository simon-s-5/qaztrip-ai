// Tests of retry + fallback logic with a fake AI (no network). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { AiBusyError, runWithFallback } from "../lib/aiRetry.ts";

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const timeoutError = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });

/** Fake AI: each model has a queue of results; an Error is thrown, anything else is returned. */
function fakeAi(script: Record<string, unknown[]>) {
  const calls: string[] = [];
  const call = async (model: string) => {
    calls.push(model);
    const next = script[model]?.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error(`no more answers for ${model}`);
    return next;
  };
  return { call, calls };
}

function opts(delays: number[]) {
  return {
    budgetMs: 60_000,
    baseDelayMs: 1000,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

test("503 is retried with exponential backoff, then succeeds on the same model", async () => {
  const delays: number[] = [];
  const ai = fakeAi({ main: [httpError(503), httpError(503), "ok"] });
  const r = await runWithFallback(["main", "backup"], ai.call, opts(delays));
  assert.equal(r.value, "ok");
  assert.equal(r.model, "main");
  assert.equal(r.fallback, false);
  assert.deepEqual(ai.calls, ["main", "main", "main"]);
  assert.equal(delays.length, 2);
  assert.ok(delays[0] >= 1000 && delays[0] < 1300, `first delay ${delays[0]}`);
  assert.ok(delays[1] >= 2000 && delays[1] < 2300, `second delay ${delays[1]}`);
});

test("429 is retried too", async () => {
  const delays: number[] = [];
  const ai = fakeAi({ main: [httpError(429), "ok"] });
  const r = await runWithFallback(["main"], ai.call, opts(delays));
  assert.equal(r.value, "ok");
  assert.equal(delays.length, 1);
});

test("after 3 failed attempts it switches to the fallback model", async () => {
  const ai = fakeAi({ main: [httpError(503), httpError(503), httpError(503)], backup: ["ok"] });
  const r = await runWithFallback(["main", "backup"], ai.call, opts([]));
  assert.equal(r.model, "backup");
  assert.equal(r.fallback, true);
  assert.deepEqual(ai.calls, ["main", "main", "main", "backup"]);
});

test("a timeout switches to the next model immediately", async () => {
  const ai = fakeAi({ main: [timeoutError()], backup: ["ok"] });
  const r = await runWithFallback(["main", "backup"], ai.call, opts([]));
  assert.equal(r.model, "backup");
  assert.deepEqual(ai.calls, ["main", "backup"]);
});

test("a malformed answer switches to the next model", async () => {
  const ai = fakeAi({ main: [new SyntaxError("bad JSON")], backup: ["ok"] });
  const r = await runWithFallback(["main", "backup"], ai.call, opts([]));
  assert.equal(r.model, "backup");
});

test("the fallback list is tried in order", async () => {
  const ai = fakeAi({ a: [httpError(404)], b: [timeoutError()], c: ["ok"] });
  const r = await runWithFallback(["a", "b", "c"], ai.call, opts([]));
  assert.equal(r.model, "c");
  assert.deepEqual(ai.calls, ["a", "b", "c"]);
});

test("when every model fails, AiBusyError is thrown", async () => {
  const ai = fakeAi({
    main: [httpError(503), httpError(503), httpError(503)],
    backup: [httpError(503), httpError(503), httpError(503)],
  });
  await assert.rejects(runWithFallback(["main", "backup"], ai.call, opts([])), AiBusyError);
  assert.equal(ai.calls.length, 6);
});

test("an invalid key (403) is not retried", async () => {
  const ai = fakeAi({ main: [httpError(403)], backup: ["ok"] });
  await assert.rejects(runWithFallback(["main", "backup"], ai.call, opts([])), (e: { status?: number }) => e.status === 403);
  assert.deepEqual(ai.calls, ["main"]);
});

test("the time budget is respected", async () => {
  const ai = fakeAi({ main: [httpError(503), "ok"] });
  // Budget too small for a 1 s backoff: give up instead of waiting past the deadline.
  await assert.rejects(runWithFallback(["main"], ai.call, { budgetMs: 2000, baseDelayMs: 1000 }), AiBusyError);
  assert.deepEqual(ai.calls, ["main"]);
});

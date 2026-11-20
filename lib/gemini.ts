import "server-only";
import { GoogleGenAI, type Content } from "@google/genai";
import { runWithFallback } from "./aiRetry";

/**
 * Primary model: Gemini 3.8 Flash — the current stable Flash model with a free tier
 * (checked in the Gemini API docs, Nov 2026).
 * Fallback models (free tier, separate capacity): Gemini 3.5 Flash-Lite, then 3.1 Flash-Lite.
 * Override in .env.local: GEMINI_MODEL and GEMINI_FALLBACK_MODEL (comma-separated list).
 */
export const DEFAULT_MODEL = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODELS = "gemini-3.5-flash-lite,gemini-3.1-flash-lite";

export class MissingKeyError extends Error {
  constructor(name: string) {
    super(`${name} is not set`);
    this.name = "MissingKeyError";
  }
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingKeyError("GEMINI_API_KEY");
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export function getModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export function getFallbackModels(): string[] {
  const raw = process.env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODELS;
  const primary = getModel();
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s && s !== primary))];
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Time limits of one AI call (ms). Vercel functions here are limited to 60 s in total. */
export type CallLimits = { budgetMs?: number; attemptTimeoutMs?: number; maxAttempts?: number };

function withFallback<T>(call: (model: string, signal: AbortSignal) => Promise<T>, limits: CallLimits = {}) {
  return runWithFallback([getModel(), ...getFallbackModels()], call, {
    budgetMs: limits.budgetMs ?? 50_000,
    attemptTimeoutMs: limits.attemptTimeoutMs ?? 25_000,
    maxAttempts: limits.maxAttempts ?? 3,
    onRetry: ({ model, attempt, status, delayMs }) =>
      console.warn(`Gemini ${model}: ${status}, retry ${attempt} in ${delayMs} ms`),
    onFallback: ({ from, to, reason }) => console.warn(`Gemini ${from} failed (${reason}), switching to ${to}`),
  });
}

/**
 * Calls Gemini with a JSON schema. `parse` validates the answer inside the retry loop,
 * so a malformed answer from one model triggers the next model instead of an error.
 */
export async function geminiJson<T = unknown>(opts: {
  system: string;
  prompt: string;
  schema: object;
  parse?: (data: unknown) => T;
  limits?: CallLimits;
}) {
  const ai = getClient(); // throws MissingKeyError before any retries
  const r = await withFallback(async (model, abortSignal) => {
    const res = await ai.models.generateContent({
      model,
      contents: opts.prompt,
      config: {
        abortSignal,
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseJsonSchema: opts.schema,
      },
    });
    const text = res.text;
    if (!text) throw new Error("Empty response from Gemini");
    const data: unknown = JSON.parse(text);
    return opts.parse ? opts.parse(data) : (data as T);
  }, opts.limits);
  return { data: r.value, model: r.model, fallback: r.fallback };
}

/** Calls Gemini for plain text (chat). */
export async function geminiText(opts: { system: string; contents: Content[]; limits?: CallLimits }) {
  const ai = getClient();
  const r = await withFallback(async (model, abortSignal) => {
    const res = await ai.models.generateContent({
      model,
      contents: opts.contents,
      config: { abortSignal, systemInstruction: opts.system },
    });
    const text = res.text;
    if (!text) throw new Error("Empty response from Gemini");
    return text.trim();
  }, opts.limits);
  return { text: r.value, model: r.model, fallback: r.fallback };
}

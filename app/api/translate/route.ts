import { z } from "zod";
import { geminiJson } from "@/lib/gemini";
import { MemoryCache } from "@/lib/cache";
import { apiError, checkLimit, handleAiError, LANGUAGE_RE } from "@/lib/api";
import { acceptTranslation, readAnswer, translatePrompt, TRANSLATE_SYSTEM, type Flat } from "@/lib/translation";
import { PARTS, SOURCES } from "@/lib/translationSources";

/**
 * Live AI translation for languages that are not pre-translated (public/locales).
 * One request = one small part (~40 strings), so a call takes seconds, not a minute:
 * the browser asks for the parts, retries a failed part and caches every part in localStorage.
 */
export const maxDuration = 30;

const Body = z.object({
  language: z.string().trim().regex(LANGUAGE_RE),
  kind: z.enum(["ui", "places"]),
  part: z.number().int().min(0).max(100).optional().default(0),
});

type PartResult = { strings: Flat; dir: "ltr" | "rtl"; locale: string; part: number; parts: number };
const cache = new MemoryCache<PartResult>(500);

/** Accept the answer only if almost every string is fine; otherwise the next model is tried. */
const MIN_OK_SHARE = 0.9;

async function translatePart(language: string, kind: "ui" | "places", part: number): Promise<PartResult> {
  const keys = PARTS[kind][part];
  const all = SOURCES[kind];
  const source: Flat = Object.fromEntries(keys.map((k) => [k, all[k]]));
  const { data } = await geminiJson({
    system: TRANSLATE_SYSTEM,
    prompt: translatePrompt(language, source),
    // No response schema: a schema with dozens of required keys is rejected by the Flash-Lite fallbacks
    // ("too many states") — this was why translations failed whenever the primary model was busy.
    parse: (raw) => {
      const answer = readAnswer(raw);
      const { ok, bad } = acceptTranslation(source, answer.strings);
      if (Object.keys(ok).length < keys.length * MIN_OK_SHARE) throw new Error(`Bad translation: ${bad.length} of ${keys.length} rejected`);
      return { ...answer, strings: ok };
    },
    // Short limits: well inside the Vercel function time limit, with retries and fallback models.
    limits: { budgetMs: 24_000, attemptTimeoutMs: 12_000, maxAttempts: 2 },
  });
  let locale = data.locale;
  try {
    if (locale) new Intl.NumberFormat(locale);
  } catch {
    locale = "";
  }
  return { strings: data.strings, dir: data.dir, locale, part, parts: PARTS[kind].length };
}

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, "bad_request", "Invalid input");
  const { kind, part } = body.data;
  if (part >= PARTS[kind].length) return apiError(400, "bad_request", "No such part");
  const language = body.data.language.replace(/\s+/g, " ");
  const key = `${kind}:${part}:${language.toLowerCase()}`;

  // Cached translations do not count towards the rate limit.
  const cached = cache.get(key);
  if (cached) return Response.json({ ...cached, cached: true });

  // One language = about a dozen small parts, so the limit is per part.
  const limited = checkLimit(req, "translate", 40, 400);
  if (limited) return limited;

  try {
    const data = await cache.getOrCreate(key, () => translatePart(language, kind, part));
    return Response.json({ ...data, cached: false });
  } catch (e) {
    return handleAiError(e);
  }
}

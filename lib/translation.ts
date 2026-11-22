/**
 * Translation helpers shared by the site, the API route and the one-off script
 * (scripts/translate-locales.mts). Pure logic, no secrets, unit-tested: tests/translation.test.mts.
 *
 * Everything to translate is a flat { key: English text } map:
 *  - the UI dictionary (lib/dictionaries.ts `en`),
 *  - place texts and general cost labels, flattened to keys like "p.charyn.description" / "c.metro".
 * Big maps are split into small parts, so one AI call stays short (no Vercel timeout,
 * no huge JSON schema) and a failed part can be retried on its own.
 */

/** Popular languages translated once in advance (public/locales/<code>.json) and loaded without AI. */
export const PRETRANSLATED = ["zh", "ko", "ja", "tr", "ar", "hi", "uz", "de", "fr", "es"] as const;
export type PretranslatedCode = (typeof PRETRANSLATED)[number];
export const isPretranslated = (code: string): code is PretranslatedCode =>
  (PRETRANSLATED as readonly string[]).includes(code);
/** Place descriptions are pre-translated for the same languages plus the built-in Kazakh and Russian UI languages. */
export const PRETRANSLATED_PLACES = [...PRETRANSLATED, "kk", "ru"] as const;
export const hasPretranslatedPlaces = (code: string) => (PRETRANSLATED_PLACES as readonly string[]).includes(code);

/** Keys per AI call for live translation. ~40 short strings ≈ a few seconds per call. */
export const UI_PART_SIZE = 40;
export const PLACES_PART_SIZE = 40;

export type Flat = Record<string, string>;

/** Small stable hash (djb2), used to notice that an English source text changed. */
export function textHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Splits keys into parts of `size`, in a fixed order (the same on the client and the server). */
export function partsOf(keys: readonly string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < keys.length; i += size) out.push(keys.slice(i, i + size));
  return out;
}

// ---------- places: structured texts <-> flat map ----------

export type PlaceTexts = {
  name: string;
  region: string;
  description: string;
  howToGet: string;
  season: string;
  durationHint: string;
  roadNote: string;
  priceLabels: Record<string, string>;
};
const PLACE_FIELDS = ["name", "region", "description", "howToGet", "season", "durationHint", "roadNote"] as const;

/** Raw places.json entry → its translatable texts (same as lib/places.ts placeText). */
export function placeTexts(p: {
  name: string;
  region: string;
  description: string;
  howToGet: string;
  season: string;
  durationHint: string;
  roadStatus?: { note: string };
  prices: { id: string; label: string }[];
}): PlaceTexts {
  return {
    name: p.name,
    region: p.region,
    description: p.description,
    howToGet: p.howToGet,
    season: p.season,
    durationHint: p.durationHint,
    roadNote: p.roadStatus?.note ?? "",
    priceLabels: Object.fromEntries(p.prices.map((pr) => [pr.id, pr.label])),
  };
}

export function flattenPlaces(places: Record<string, PlaceTexts>, costs: Record<string, string>): Flat {
  const out: Flat = {};
  for (const [id, t] of Object.entries(places)) {
    for (const f of PLACE_FIELDS) if (t[f]) out[`p.${id}.${f}`] = t[f];
    for (const [pid, label] of Object.entries(t.priceLabels)) out[`p.${id}.price.${pid}`] = label;
  }
  for (const [id, label] of Object.entries(costs)) out[`c.${id}`] = label;
  return out;
}

/** Flat translation → structured texts; anything missing stays English (the original). */
export function unflattenPlaces(
  original: Record<string, PlaceTexts>,
  originalCosts: Record<string, string>,
  flat: Flat,
): { places: Record<string, PlaceTexts>; costs: Record<string, string> } {
  const places: Record<string, PlaceTexts> = {};
  for (const [id, t] of Object.entries(original)) {
    const p: PlaceTexts = { ...t, priceLabels: { ...t.priceLabels } };
    for (const f of PLACE_FIELDS) if (t[f]) p[f] = flat[`p.${id}.${f}`] || t[f];
    for (const pid of Object.keys(t.priceLabels)) p.priceLabels[pid] = flat[`p.${id}.price.${pid}`] || t.priceLabels[pid];
    places[id] = p;
  }
  const costs: Record<string, string> = {};
  for (const [id, label] of Object.entries(originalCosts)) costs[id] = flat[`c.${id}`] || label;
  return { places, costs };
}

// ---------- quality checks ----------

const PLACEHOLDER_RE = /\{[A-Za-z]+\}/g;
export const placeholders = (s: string) => (s.match(PLACEHOLDER_RE) ?? []).sort();
const KEEP = ["QazTrip AI", "₸", "USD", "$"];

/** Why one translated value is not acceptable, or null if it is fine. */
export function valueProblem(source: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "empty";
  if (value.length > source.length * 4 + 40) return "too long";
  if (placeholders(source).join() !== placeholders(value).join()) return "placeholders changed";
  for (const k of KEEP) if (source.includes(k) && !value.includes(k)) return `"${k}" lost`;
  if (/<\/?[a-z][^>]*>/i.test(value) && !/<\/?[a-z][^>]*>/i.test(source)) return "markup added";
  return null;
}

/** Keeps only acceptable values for the requested keys; reports the rest. */
export function acceptTranslation(source: Flat, raw: unknown): { ok: Flat; bad: string[] } {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ok: Flat = {};
  const bad: string[] = [];
  for (const [k, src] of Object.entries(source)) {
    const v = r[k];
    if (valueProblem(src, v) === null) ok[k] = (v as string).trim();
    else bad.push(k);
  }
  return { ok, bad };
}

/** Script a language is written in, to catch "translations" that stayed in English. */
const SCRIPTS: Record<string, RegExp> = {
  zh: /\p{Script=Han}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ko: /\p{Script=Hangul}/u,
  ar: /\p{Script=Arabic}/u,
  hi: /\p{Script=Devanagari}/u,
};

/**
 * Whole-language check: values in the expected script (non-Latin languages) and not left in English.
 * Returns the share of values that look untranslated (0..1).
 */
export function untranslatedShare(code: string, source: Flat, out: Flat): number {
  const script = SCRIPTS[code];
  let checked = 0;
  let bad = 0;
  for (const [k, src] of Object.entries(source)) {
    const v = out[k];
    if (!v || src.replace(PLACEHOLDER_RE, "").replace(/[^\p{L}]/gu, "").length < 4) continue; // too short to judge
    checked++;
    if (script ? !script.test(v) : v === src && /[a-z]{4,}\s+[a-z]{3,}/i.test(src)) bad++;
  }
  return checked === 0 ? 0 : bad / checked;
}

// ---------- prompt ----------

export const TRANSLATE_SYSTEM =
  "You are a professional localization engine for QazTrip AI, a tourism website about Almaty and the Almaty region of Kazakhstan. " +
  "Translate naturally and concisely for foreign tourists. Keep exactly as they are: the brand name 'QazTrip AI', the signs ₸ and $, " +
  "'USD', numbers, and placeholders in curly braces (like {n} or {amount}). " +
  "Use well-known names of places in the target language when they exist. Return only JSON.";

/**
 * Asks for {"dir", "locale", "strings"}: the translated object with the same keys,
 * plus text direction and BCP-47 tag of the language (needed for languages typed by the user).
 */
export function translatePrompt(language: string, source: Flat): string {
  return (
    `Translate the values of the JSON object below from English into ${language}. ` +
    `Return JSON: {"dir": "ltr" or "rtl" for ${language}, "locale": the BCP-47 tag of ${language}, ` +
    `"strings": an object with exactly the same keys and the translated values}.\n\n${JSON.stringify(source)}`
  );
}

/** Reads {"dir","locale","strings"} from an AI answer (tolerates a bare object of strings). */
export function readAnswer(raw: unknown): { dir: "ltr" | "rtl"; locale: string; strings: unknown } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strings = r.strings && typeof r.strings === "object" ? r.strings : r;
  const locale = typeof r.locale === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(r.locale) ? r.locale : "";
  return { dir: r.dir === "rtl" ? "rtl" : "ltr", locale, strings };
}

// ---------- loading ----------

/** Values from a pre-translated file whose English source has not changed since (others fall back to English). */
export function freshValues(source: Flat, values: Flat = {}, hashes: Record<string, string> = {}): Flat {
  const out: Flat = {};
  for (const [k, src] of Object.entries(source)) {
    if (values[k] && hashes[k] === textHash(src)) out[k] = values[k];
  }
  return out;
}

/** Runs `fn` for every item with at most `limit` at a time. */
export async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

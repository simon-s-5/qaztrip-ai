/**
 * One-off pre-translation of popular languages → public/locales/<code>.json.
 * The site loads these files directly (no AI at runtime).
 *
 *   node scripts/translate-locales.mts            # all languages in PRETRANSLATED
 *   node scripts/translate-locales.mts zh ko      # only these
 *
 * Incremental: only strings that are missing or whose English source changed are translated
 * (each file stores a hash of the English text per key). Reads GEMINI_API_KEY from .env.local
 * (never printed). Every value goes through the same checks as live translation, and the whole
 * language is checked for strings left in English. Review the result before committing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { en } from "../lib/dictionaries.ts";
import { LANGUAGES } from "../lib/languages.ts";
import { runWithFallback } from "../lib/aiRetry.ts";
import {
  acceptTranslation,
  flattenPlaces,
  partsOf,
  placeTexts,
  PRETRANSLATED,
  readAnswer,
  textHash,
  translatePrompt,
  TRANSLATE_SYSTEM,
  untranslatedShare,
  type Flat,
} from "../lib/translation.ts";

const root = new URL("../", import.meta.url);
const readJson = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const env = existsSync(new URL(".env.local", root)) ? readFileSync(new URL(".env.local", root), "utf8") : "";
const envVar = (name: string) => process.env[name] || new RegExp(`^${name}=(.*)$`, "m").exec(env)?.[1]?.trim() || "";

const apiKey = envVar("GEMINI_API_KEY");
if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env.local");
const ai = new GoogleGenAI({ apiKey });
const models = [
  ...new Set(
    [envVar("GEMINI_MODEL") || "gemini-3.8-flash", ...(envVar("GEMINI_FALLBACK_MODEL") || "gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",")]
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

const UI: Flat = en as unknown as Flat;
const places = readJson("data/places.json") as (Parameters<typeof placeTexts>[0] & { id: string })[];
const costs = readJson("data/costs.json") as { id: string; label: string }[];
const PLACES_FLAT = flattenPlaces(
  Object.fromEntries(places.map((p) => [p.id, placeTexts(p)])),
  Object.fromEntries(costs.map((c) => [c.id, c.label])),
);

const PART = 35;

type LocaleFile = {
  code: string;
  language: string;
  native: string;
  dir: "ltr" | "rtl";
  locale: string;
  generated: string;
  method: string;
  ui: Flat;
  uiSource: Record<string, string>;
  places: Flat;
  placesSource: Record<string, string>;
};

async function translatePart(language: string, source: Flat): Promise<Flat> {
  const r = await runWithFallback(
    models,
    async (model, abortSignal) => {
      const res = await ai.models.generateContent({
        model,
        contents: translatePrompt(language, source),
        config: { abortSignal, systemInstruction: TRANSLATE_SYSTEM, responseMimeType: "application/json", temperature: 0.2 },
      });
      if (!res.text) throw new Error("empty");
      const { ok, bad } = acceptTranslation(source, readAnswer(JSON.parse(res.text)).strings);
      if (bad.length > 0) console.warn(`    ${model}: rejected ${bad.join(", ")}`);
      if (Object.keys(ok).length < Object.keys(source).length * 0.8) throw new Error("too many rejected values");
      return ok;
    },
    {
      budgetMs: 180_000,
      attemptTimeoutMs: 60_000,
      maxAttempts: 4,
      baseDelayMs: 4000,
      onRetry: ({ model, status, delayMs }) => console.warn(`    ${model}: ${status}, retry in ${delayMs} ms`),
      onFallback: ({ from, to, reason }) => console.warn(`    ${from} failed (${reason}) → ${to}`),
    },
  );
  return r.value;
}

/** Translates the keys that are missing or stale; up to 3 rounds for keys rejected by the checks. */
async function fill(language: string, source: Flat, out: Flat, hashes: Record<string, string>, label: string, save: () => void) {
  for (let round = 0; round < 3; round++) {
    const todo = Object.keys(source).filter((k) => !out[k] || hashes[k] !== textHash(source[k]));
    if (todo.length === 0) return;
    console.log(`  ${label}: ${todo.length} strings (round ${round + 1})`);
    for (const keys of partsOf(todo, PART)) {
      const part = Object.fromEntries(keys.map((k) => [k, source[k]]));
      try {
        const ok = await translatePart(language, part);
        for (const [k, v] of Object.entries(ok)) {
          out[k] = v;
          hashes[k] = textHash(source[k]);
        }
        save(); // progress is kept even if the script is stopped
        process.stdout.write(".");
      } catch (e) {
        console.warn(`    part failed: ${(e as Error).message}`);
      }
    }
  }
}

const wanted = process.argv.slice(2);
const codes = wanted.length ? wanted : [...PRETRANSLATED];
mkdirSync(new URL("public/locales/", root), { recursive: true });

for (const code of codes) {
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang) throw new Error(`Unknown language code: ${code}`);
  const file = new URL(`public/locales/${code}.json`, root);
  const prev: Partial<LocaleFile> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const data: LocaleFile = {
    code,
    language: lang.name,
    native: lang.native,
    dir: lang.dir ?? "ltr",
    locale: lang.locale,
    generated: new Date().toISOString().slice(0, 10),
    method: "Pre-translated once with Gemini (scripts/translate-locales.mts), automatic quality checks. Translations are made by AI and may contain mistakes",
    ui: prev.ui ?? {},
    uiSource: prev.uiSource ?? {},
    places: prev.places ?? {},
    placesSource: prev.placesSource ?? {},
  };
  console.log(`${code} — ${lang.name}`);
  const save = () => writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
  if (!["kk", "ru"].includes(code)) await fill(lang.name, UI, data.ui, data.uiSource, "ui", save);
  await fill(lang.name, PLACES_FLAT, data.places, data.placesSource, "places", save);

  // Drop keys that no longer exist in the English source.
  for (const [src, out, h] of [[UI, data.ui, data.uiSource], [PLACES_FLAT, data.places, data.placesSource]] as const)
    for (const k of Object.keys(out)) if (!(k in src)) { delete out[k]; delete h[k]; }

  const missing = Object.keys(UI).filter((k) => !data.ui[k]).length + Object.keys(PLACES_FLAT).filter((k) => !data.places[k]).length;
  const share = Math.max(untranslatedShare(code, UI, data.ui), untranslatedShare(code, PLACES_FLAT, data.places));
  console.log(`  missing: ${missing}, looks untranslated: ${(share * 100).toFixed(1)}%`);
  writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
}

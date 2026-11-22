/**
 * Browser side of translations.
 *  1. Pre-translated popular languages: a static file public/locales/<code>.json — no AI.
 *  2. Other languages: live AI translation in small parts (/api/translate), up to 3 parts at a time,
 *     each part retried, every finished part cached in localStorage (a retry only asks for what is missing).
 * Returns null when the translation could not be completed: the caller keeps English.
 */
import { postJson, storageGet, storageSet } from "./client";
import { freshValues, runPool, textHash, type Flat } from "./translation";
import { PARTS, SOURCES } from "./translationSources";

export type Kind = "ui" | "places";
export type Translated = { strings: Flat; dir: "ltr" | "rtl"; locale: string };

type LocaleFile = {
  dir: "ltr" | "rtl";
  locale: string;
  ui: Flat;
  uiSource: Record<string, string>;
  places: Flat;
  placesSource: Record<string, string>;
};

const files = new Map<string, Promise<LocaleFile | null>>();

function localeFile(code: string): Promise<LocaleFile | null> {
  let p = files.get(code);
  if (!p) {
    p = fetch(`/locales/${code}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<LocaleFile>) : null))
      .catch(() => null);
    files.set(code, p);
    void p.then((f) => f ?? files.delete(code)); // a failed download can be tried again later
  }
  return p;
}

/** Pre-translated strings for `kind`; English for strings whose source changed after the file was made. */
export async function loadPretranslated(code: string, kind: Kind): Promise<Translated | null> {
  const f = await localeFile(code);
  if (!f) return null;
  const strings = kind === "ui" ? freshValues(SOURCES.ui, f.ui, f.uiSource) : freshValues(SOURCES.places, f.places, f.placesSource);
  return { strings: { ...SOURCES[kind], ...strings }, dir: f.dir, locale: f.locale };
}

const VERSION: Record<Kind, string> = {
  ui: textHash(JSON.stringify(PARTS.ui) + JSON.stringify(SOURCES.ui)),
  places: textHash(JSON.stringify(PARTS.places) + JSON.stringify(SOURCES.places)),
};

type Stored = { v: string; dir: "ltr" | "rtl"; locale: string; parts: Record<number, Flat> };
type PartAnswer = { strings: Flat; dir: "ltr" | "rtl"; locale: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function translateWithAi(kind: Kind, language: string, storageKey: string): Promise<Translated | null> {
  const stored = storageGet<Stored>(storageKey);
  const s: Stored = stored?.v === VERSION[kind] && stored.parts ? stored : { v: VERSION[kind], dir: "ltr", locale: "", parts: {} };
  const missing = PARTS[kind].map((_, i) => i).filter((i) => !s.parts[i]);

  await runPool(missing, 3, async (part) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const a = await postJson<PartAnswer>("/api/translate", { language, kind, part });
        s.parts[part] = a.strings;
        if (part === 0 || !s.locale) {
          s.dir = a.dir;
          s.locale = a.locale || s.locale;
        }
        storageSet(storageKey, s);
        return;
      } catch {
        if (attempt < 2) await wait(1500 * (attempt + 1));
      }
    }
  });

  if (PARTS[kind].some((_, i) => !s.parts[i])) return null;
  return { strings: { ...SOURCES[kind], ...Object.assign({}, ...Object.values(s.parts)) }, dir: s.dir, locale: s.locale };
}

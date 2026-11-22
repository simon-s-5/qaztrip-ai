"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BUILTIN, en, type Dict, type DictKey } from "@/lib/dictionaries";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/languages";
import type { PlaceText } from "@/lib/places";
import { usdAmount } from "@/lib/currency";
import { storageGet, storageSet } from "@/lib/client";
import { hasPretranslatedPlaces, isPretranslated, unflattenPlaces } from "@/lib/translation";
import { ORIGINAL_COSTS, ORIGINAL_PLACES } from "@/lib/translationSources";
import { loadPretranslated, translateWithAi, type Translated } from "@/lib/translationClient";

const LANG_KEY = "qaztrip:lang";

type UiPayload = { strings: Dict; dir: "ltr" | "rtl"; locale: string };
type PlacesPayload = { places: Record<string, PlaceText>; costs?: Record<string, string> };
/** "error": the translation could not be completed — the site stays in English with a small notice. */
type Status = "idle" | "translating" | "error";

type Ctx = {
  language: Language;
  dir: "ltr" | "rtl";
  locale: string;
  status: Status;
  /** True when the current UI strings come from live AI translation (not pre-translated). */
  aiTranslated: boolean;
  setLanguage: (l: Language) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  formatKzt: (n: number) => string;
  /** Approximate USD next to a ₸ amount or range, e.g. "≈ $40–70 approx."; "" when free. */
  formatUsd: (min: number, max?: number) => string;
  /** "20 000 ₸ (≈ $40 approx.)" — for amounts inside sentences. */
  money: (n: number) => string;
  placeText: (id: string) => PlaceText;
  /** Label of a general cost (transport, meal, accommodation), translated if available. */
  costLabel: (id: string) => string;
  placesTranslated: boolean;
  ensurePlaces: () => void;
};

const LanguageContext = createContext<Ctx | null>(null);

function cacheKey(kind: string, l: Language) {
  return `qaztrip:${kind}:v2:${l.name.toLowerCase()}`;
}

function validLocale(tag: string | undefined, fallback: string) {
  try {
    if (tag) new Intl.NumberFormat(tag);
    return tag || fallback;
  } catch {
    return fallback;
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>(DEFAULT_LANGUAGE);
  const [ui, setUi] = useState<UiPayload>({ strings: en, dir: "ltr", locale: "en" });
  const [aiTranslated, setAiTranslated] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [places, setPlaces] = useState<PlacesPayload | null>(null);
  const reqId = useRef(0);

  const loadUi = useCallback(async (l: Language) => {
    const id = ++reqId.current;
    const builtin = BUILTIN[l.code];
    if (builtin) {
      setUi({ strings: builtin, dir: l.dir ?? "ltr", locale: l.locale });
      setAiTranslated(false);
      setStatus("idle");
      return;
    }
    setStatus("translating");
    // Popular languages: the pre-translated file (no AI). Others, or if the file cannot be loaded: AI in parts.
    let data: Translated | null = isPretranslated(l.code) ? await loadPretranslated(l.code, "ui") : null;
    const fromAi = !data;
    if (!data) data = await translateWithAi("ui", l.name, cacheKey("ui", l));
    if (id !== reqId.current) return;
    if (!data) {
      // Never an error screen: keep English and show a small notice.
      setUi({ strings: en, dir: "ltr", locale: "en" });
      setAiTranslated(false);
      setStatus("error");
      return;
    }
    setUi({ strings: data.strings as Dict, dir: l.dir ?? data.dir, locale: validLocale(l.locale || data.locale, "en") });
    setAiTranslated(fromAi);
    setStatus("idle");
  }, []);

  const placesReq = useRef(0);
  const loadPlaces = useCallback(async (l: Language) => {
    const id = ++placesReq.current;
    setPlaces(null);
    if (l.code === "en") return;
    let data = hasPretranslatedPlaces(l.code) ? await loadPretranslated(l.code, "places") : null;
    if (!data) data = await translateWithAi("places", l.name, cacheKey("places", l));
    if (!data || id !== placesReq.current) return; // not available: English descriptions stay
    setPlaces(unflattenPlaces(ORIGINAL_PLACES, ORIGINAL_COSTS, data.strings));
  }, []);

  // Restore the language the visitor picked before; otherwise English (the default for foreign tourists).
  useEffect(() => {
    const saved = storageGet<Language>(LANG_KEY);
    const initial = saved?.name ? saved : DEFAULT_LANGUAGE;
    // localStorage is only available after hydration, so this must run in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLang(initial);
    void loadUi(initial);
  }, [loadUi]);

  useEffect(() => {
    document.documentElement.lang = ui.locale;
    document.documentElement.dir = ui.dir;
  }, [ui]);

  const setLanguage = useCallback(
    (l: Language) => {
      setLang(l);
      storageSet(LANG_KEY, l);
      void loadUi(l);
    },
    [loadUi],
  );

  // Place descriptions are translated only when a page that shows them asks for it.
  const [placesWanted, setPlacesWanted] = useState(false);
  const ensurePlaces = useCallback(() => setPlacesWanted(true), []);
  useEffect(() => {
    // Syncs with external storage / API for the current language.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (placesWanted) void loadPlaces(language);
  }, [placesWanted, language, loadPlaces]);

  const value = useMemo<Ctx>(() => {
    const nf = (() => {
      try {
        return new Intl.NumberFormat(ui.locale, { maximumFractionDigits: 0 });
      } catch {
        return new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
      }
    })();
    const fill = (key: DictKey, vars?: Record<string, string | number>) => {
      let s = ui.strings[key] ?? en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    const kzt = (n: number) => `${nf.format(n)} ₸`;
    const usd = (min: number, max?: number) => {
      const a = usdAmount(min, max);
      return a ? fill("currency.usd", { amount: a }) : "";
    };
    return {
      language,
      dir: ui.dir,
      locale: ui.locale,
      status,
      aiTranslated,
      setLanguage,
      t: fill,
      formatKzt: kzt,
      formatUsd: usd,
      money: (n) => (usd(n) ? `${kzt(n)} (${usd(n)})` : kzt(n)),
      placeText: (id) => places?.places[id] ?? ORIGINAL_PLACES[id],
      costLabel: (id) => places?.costs?.[id] ?? ORIGINAL_COSTS[id] ?? id,
      placesTranslated: Boolean(places) && language.code !== "en",
      ensurePlaces,
    };
  }, [language, ui, status, aiTranslated, setLanguage, places, ensurePlaces]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useI18n must be used inside LanguageProvider");
  return ctx;
}

/** Use on pages that show place descriptions: triggers AI translation of the catalog. */
export function usePlacesI18n() {
  const ctx = useI18n();
  const { ensurePlaces } = ctx;
  useEffect(() => ensurePlaces(), [ensurePlaces]);
  return ctx;
}

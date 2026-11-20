"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BUILTIN, en, type Dict, type DictKey } from "@/lib/dictionaries";
import { DEFAULT_LANGUAGE, detectLanguage, type Language } from "@/lib/languages";
import { PLACES, placeText, type PlaceText } from "@/lib/places";
import { COSTS } from "@/lib/costs";
import { hash, postJson, storageGet, storageSet } from "@/lib/client";

const UI_VERSION = hash(JSON.stringify(en));
const PLACES_VERSION = hash(JSON.stringify([PLACES.map(placeText), COSTS.map((c) => c.label)]));
const LANG_KEY = "sapar:lang";

type UiPayload = { strings: Dict; dir: "ltr" | "rtl"; locale: string };
type PlacesPayload = { places: Record<string, PlaceText>; costs?: Record<string, string> };
type Status = "idle" | "translating" | "error";

type Ctx = {
  language: Language;
  dir: "ltr" | "rtl";
  locale: string;
  status: Status;
  /** True when the current UI strings come from AI translation. */
  aiTranslated: boolean;
  setLanguage: (l: Language) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  formatKzt: (n: number) => string;
  placeText: (id: string) => PlaceText;
  /** Label of a general cost (transport, meal, accommodation), translated if available. */
  costLabel: (id: string) => string;
  placesTranslated: boolean;
  ensurePlaces: () => void;
};

const LanguageContext = createContext<Ctx | null>(null);

const ORIGINAL_PLACES: Record<string, PlaceText> = Object.fromEntries(PLACES.map((p) => [p.id, placeText(p)]));
const ORIGINAL_COSTS: Record<string, string> = Object.fromEntries(COSTS.map((c) => [c.id, c.label]));

function cacheKey(kind: string, l: Language) {
  return `sapar:${kind}:${l.name.toLowerCase()}`;
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
    const cached = storageGet<UiPayload & { v: string }>(cacheKey("ui", l));
    if (cached?.v === UI_VERSION) {
      setUi({ strings: { ...en, ...cached.strings }, dir: cached.dir, locale: l.locale || cached.locale });
      setAiTranslated(true);
      setStatus("idle");
      return;
    }
    setStatus("translating");
    try {
      const data = await postJson<UiPayload>("/api/translate", { language: l.name, kind: "ui" });
      if (id !== reqId.current) return;
      storageSet(cacheKey("ui", l), { ...data, v: UI_VERSION });
      setUi({ strings: data.strings, dir: l.dir ?? data.dir, locale: l.locale || data.locale });
      setAiTranslated(true);
      setStatus("idle");
    } catch {
      if (id !== reqId.current) return;
      setUi({ strings: en, dir: "ltr", locale: "en" });
      setAiTranslated(false);
      setStatus("error");
    }
  }, []);

  const placesReq = useRef(0);
  const loadPlaces = useCallback(async (l: Language) => {
    const id = ++placesReq.current;
    setPlaces(null);
    if (l.code === "en") return;
    const cached = storageGet<PlacesPayload & { v: string }>(cacheKey("places", l));
    if (cached?.v === PLACES_VERSION) {
      setPlaces(cached);
      return;
    }
    try {
      const data = await postJson<PlacesPayload>("/api/translate", { language: l.name, kind: "places" });
      storageSet(cacheKey("places", l), { ...data, v: PLACES_VERSION });
      if (id === placesReq.current) setPlaces(data);
    } catch {
      /* fall back to English descriptions */
    }
  }, []);

  // Restore the saved language (or detect from the browser) on first load.
  useEffect(() => {
    const saved = storageGet<Language>(LANG_KEY);
    const initial = saved?.name ? saved : detectLanguage(navigator.language);
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
    return {
      language,
      dir: ui.dir,
      locale: ui.locale,
      status,
      aiTranslated,
      setLanguage,
      t: (key, vars) => {
        let s = ui.strings[key] ?? en[key] ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
        return s;
      },
      formatKzt: (n) => `${nf.format(n)} ₸`,
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

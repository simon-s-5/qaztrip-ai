export type Language = {
  /** Code for built-in dictionaries, or "custom". */
  code: string;
  /** English name, sent to the AI. */
  name: string;
  /** Native name shown in the picker. */
  native: string;
  /** BCP-47 tag for number formatting and the html lang attribute. */
  locale: string;
  dir?: "ltr" | "rtl";
};

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English", locale: "en" },
  { code: "kk", name: "Kazakh", native: "Қазақша", locale: "kk" },
  { code: "ru", name: "Russian", native: "Русский", locale: "ru" },
  { code: "zh", name: "Chinese (Simplified)", native: "中文", locale: "zh-CN" },
  { code: "tr", name: "Turkish", native: "Türkçe", locale: "tr" },
  { code: "ko", name: "Korean", native: "한국어", locale: "ko" },
  { code: "ar", name: "Arabic", native: "العربية", locale: "ar", dir: "rtl" },
  { code: "uz", name: "Uzbek", native: "Oʻzbekcha", locale: "uz" },
  { code: "de", name: "German", native: "Deutsch", locale: "de" },
  { code: "fr", name: "French", native: "Français", locale: "fr" },
  { code: "es", name: "Spanish", native: "Español", locale: "es" },
  { code: "ja", name: "Japanese", native: "日本語", locale: "ja" },
  { code: "hi", name: "Hindi", native: "हिन्दी", locale: "hi" },
  { code: "ky", name: "Kyrgyz", native: "Кыргызча", locale: "ky" },
  { code: "fa", name: "Persian", native: "فارسی", locale: "fa", dir: "rtl" },
];

export const DEFAULT_LANGUAGE = LANGUAGES.find((l) => l.code === "en")!;

export function detectLanguage(browserLang: string | undefined): Language {
  if (!browserLang) return DEFAULT_LANGUAGE;
  const base = browserLang.toLowerCase().split("-")[0];
  return LANGUAGES.find((l) => l.code === base) ?? DEFAULT_LANGUAGE;
}

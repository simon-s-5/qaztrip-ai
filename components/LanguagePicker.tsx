"use client";

import { useState } from "react";
import { LANGUAGES } from "@/lib/languages";
import { useI18n } from "./LanguageProvider";
import { Icon } from "./Icon";

const NAME_RE = /^[\p{L}\p{M}\s\-()'’.]{1,40}$/u;

export function LanguagePicker() {
  const { t, language, setLanguage, status, aiTranslated } = useI18n();
  const [custom, setCustom] = useState("");
  const valid = NAME_RE.test(custom.trim());

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    const name = custom.trim().replace(/\s+/g, " ");
    if (!NAME_RE.test(name)) return;
    // A typed language that matches a known one uses that entry.
    const known = LANGUAGES.find(
      (l) => l.name.toLowerCase() === name.toLowerCase() || l.native.toLowerCase() === name.toLowerCase(),
    );
    setLanguage(known ?? { code: "custom", name, native: name, locale: "" });
    setCustom("");
  }

  return (
    <section id="language" className="card scroll-mt-20 p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Icon name="globe" className="h-5 w-5 text-brand" />
        {t("home.chooseLanguage")}
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {LANGUAGES.map((l) => {
          const active = language.name === l.name;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => setLanguage(l)}
              aria-pressed={active}
              className={`rounded-xl border px-2 py-2.5 text-sm transition ${
                active ? "border-brand bg-brand text-brand-ink font-semibold" : "border-line bg-surface hover:border-brand"
              }`}
              lang={l.locale}
              dir={l.dir ?? "ltr"}
            >
              {l.native}
            </button>
          );
        })}
      </div>

      <form onSubmit={applyCustom} className="mt-4">
        <label htmlFor="custom-lang" className="mb-1.5 block text-sm text-muted">
          {t("home.otherLanguage")}
        </label>
        <div className="flex gap-2">
          <input
            id="custom-lang"
            className="input"
            value={custom}
            maxLength={40}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={t("home.otherPlaceholder")}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={!valid || status === "translating"}>
            {t("home.apply")}
          </button>
        </div>
      </form>

      {language.code === "custom" || aiTranslated ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <Icon name="spark" className="h-3.5 w-3.5 text-accent" />
          {status === "translating" ? t("home.translating") : t("home.translated")}
        </p>
      ) : null}
    </section>
  );
}

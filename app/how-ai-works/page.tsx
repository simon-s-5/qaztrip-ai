"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LanguageProvider";
import { AiBadge } from "@/components/AiBadge";
import { Icon } from "@/components/Icon";
import type { DictKey } from "@/lib/dictionaries";
import { pct } from "@/components/QualityCheck";

type Metrics = {
  since: string;
  plans: number;
  planErrors: number;
  daysExact: number;
  items: number;
  itemsUnknown: number;
  placeRefs: number;
  placeRefsValid: number;
  priceRefs: number;
  priceRefsValid: number;
  moneyRemoved: number;
  overBudget: number;
  replans: number;
  replansCheaper: number;
  replansFit: number;
  chats: number;
  chatSearches: number;
  chatSearchesWithSources: number;
  chatErrors: number;
  planFallbacks: number;
  chatFallbacks: number;
};
type Status = { model: string; fallbackModels: string[]; gemini: boolean; tavily: boolean; metrics: Metrics };

const SECTIONS: { icon: string; title: DictKey; body: DictKey }[] = [
  { icon: "spark", title: "about.models.title", body: "about.models.body" },
  { icon: "wallet", title: "about.prices.title", body: "about.prices.body" },
  { icon: "car", title: "about.drivers.title", body: "about.drivers.body" },
  { icon: "alert", title: "about.road.title", body: "about.road.body" },
  { icon: "send", title: "about.request.title", body: "about.request.body" },
  { icon: "globe", title: "about.search.title", body: "about.search.body" },
  { icon: "chat", title: "about.translate.title", body: "about.translate.body" },
  { icon: "alert", title: "about.limits.title", body: "about.limits.body" },
  { icon: "check", title: "about.privacy.title", body: "about.privacy.body" },
  { icon: "alert", title: "about.risk.title", body: "about.risk.body" },
  { icon: "check", title: "about.human.title", body: "about.human.body" },
  { icon: "link", title: "about.licenses.title", body: "about.licenses.body" },
];

export default function HowAiWorksPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // Input → AI plans → server checks and calculates → over budget: AI re-plans once → unknown stays "unknown".
  const flow: DictKey[] = ["about.flow.1", "about.flow.2", "about.flow.3", "about.flow.5", "about.flow.4"];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">{t("about.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("about.intro")}</p>
      </header>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">{t("about.flow.title")}</h2>
        <ol className="space-y-3">
          {flow.map((k, i) => (
            <li key={k} className="flex gap-3 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">
                {i + 1}
              </span>
              <span className="pt-0.5">{t(k)}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <section key={s.title} className="card p-4">
            <h2 className="mb-1.5 flex items-center gap-2 font-semibold">
              <Icon name={s.icon} className="h-5 w-5 text-brand" />
              {t(s.title)}
            </h2>
            <p className="text-sm leading-relaxed text-muted">{t(s.body)}</p>
          </section>
        ))}
      </div>

      <section className="card p-4 text-sm">
        <h2 className="mb-2 font-semibold">{t("about.status")}</h2>
        <dl className="space-y-1.5">
          <Row label={t("about.model")} value={status?.model ?? "…"} />
          <Row label={t("about.fallbackModel")} value={status ? status.fallbackModels.join(", ") || "—" : "…"} />
          <Row label="Google Gemini" value={status ? (status.gemini ? t("about.ready") : t("about.notConfigured")) : "…"} ok={status?.gemini} />
          <Row label="Tavily Search" value={status ? (status.tavily ? t("about.ready") : t("about.notConfigured")) : "…"} ok={status?.tavily} />
        </dl>
      </section>

      {status?.metrics && <MetricsCard m={status.metrics} />}

      <AiBadge />
    </div>
  );
}

function MetricsCard({ m }: { m: Metrics }) {
  const { t, locale } = useI18n();
  let date = m.since;
  try {
    date = new Date(m.since).toLocaleString(locale || "en", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    /* keep ISO string */
  }
  const empty = m.plans === 0 && m.chats === 0 && m.planErrors === 0 && m.chatErrors === 0;
  return (
    <section className="card p-4 text-sm">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Icon name="check" className="h-5 w-5 text-brand" />
        {t("metrics.title")}
      </h2>
      <p className="mb-3 text-xs text-muted">{t("metrics.since", { date })}</p>
      {empty ? (
        <p className="text-muted">{t("metrics.empty")}</p>
      ) : (
        <dl className="space-y-1.5">
          <Row label={t("metrics.plans")} value={String(m.plans)} />
          <Row label={t("quality.places")} value={`${m.placeRefsValid}/${m.placeRefs} · ${pct(m.placeRefsValid, m.placeRefs)}`} />
          <Row label={t("quality.prices")} value={`${m.priceRefsValid}/${m.priceRefs} · ${pct(m.priceRefsValid, m.priceRefs)}`} />
          <Row label={t("metrics.daysExact")} value={`${m.daysExact}/${m.plans} · ${pct(m.daysExact, m.plans)}`} />
          <Row label={t("quality.money")} value={String(m.moneyRemoved)} />
          <Row label={t("quality.unknown")} value={`${m.itemsUnknown}/${m.items} · ${pct(m.itemsUnknown, m.items)}`} />
          <Row label={t("metrics.replans")} value={`${m.replansCheaper} / ${m.replansFit} (${m.replans})`} />
          <Row label={t("metrics.chats")} value={String(m.chats)} />
          <Row
            label={t("metrics.searchSources")}
            value={`${m.chatSearchesWithSources}/${m.chatSearches} · ${pct(m.chatSearchesWithSources, m.chatSearches)}`}
          />
          <Row label={t("metrics.fallbacks")} value={`${m.planFallbacks} / ${m.chatFallbacks}`} />
          <Row label={t("metrics.errors")} value={`${m.planErrors} / ${m.chatErrors}`} />
        </dl>
      )}
    </section>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="flex items-center gap-1.5 font-medium">
        {ok !== undefined && <span className={`h-2 w-2 rounded-full ${ok ? "bg-brand" : "bg-accent"}`} />}
        <span dir="ltr">{value}</span>
      </dd>
    </div>
  );
}

"use client";

import { useI18n } from "./LanguageProvider";
import { Icon } from "./Icon";
import type { PlanValidation } from "@/lib/planValidation";

export function pct(ok: number, total: number) {
  return total === 0 ? "—" : `${Math.round((ok / total) * 100)}%`;
}

/** Per-answer quality check computed by the server (lib/planValidation.ts). */
export function QualityCheck({ v }: { v: PlanValidation }) {
  const { t } = useI18n();
  const rows: { label: string; value: string; ok: boolean }[] = [
    {
      label: t("quality.places"),
      value: `${v.placeRefsValid}/${v.placeRefs} · ${pct(v.placeRefsValid, v.placeRefs)}`,
      ok: v.placeRefsValid === v.placeRefs,
    },
    {
      label: t("quality.prices"),
      value: `${v.priceRefsValid}/${v.priceRefs} · ${pct(v.priceRefsValid, v.priceRefs)}`,
      ok: v.priceRefsValid === v.priceRefs,
    },
    {
      label: t("quality.days"),
      value: `${v.daysReturned}/${v.daysRequested}`,
      ok: v.daysReturned === v.daysRequested,
    },
    {
      label: t("quality.drivers"),
      value: `${v.driverRefsValid ?? 0}/${v.driverRefs ?? 0} · ${pct(v.driverRefsValid ?? 0, v.driverRefs ?? 0)}`,
      ok: (v.driverRefsValid ?? 0) === (v.driverRefs ?? 0),
    },
    { label: t("quality.money"), value: String(v.moneyRemoved), ok: v.moneyRemoved === 0 },
    {
      label: t("quality.unknown"),
      value: `${v.itemsUnknown}/${v.items} · ${pct(v.itemsUnknown, v.items)}`,
      ok: v.itemsUnknown === 0,
    },
  ];
  return (
    <details className="card p-4 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
        <Icon name="check" className="h-5 w-5 text-brand" />
        {t("quality.title")}
        <span className="ms-auto text-xs font-normal text-muted">
          {pct(v.placeRefsValid + v.priceRefsValid, v.placeRefs + v.priceRefs)}
        </span>
      </summary>
      <dl className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3">
            <dt className="text-muted">{r.label}</dt>
            <dd className="flex shrink-0 items-center gap-1.5 font-medium tabular-nums" dir="ltr">
              <span className={`h-2 w-2 rounded-full ${r.ok ? "bg-brand" : "bg-accent"}`} />
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">{t("quality.note")}</p>
    </details>
  );
}

"use client";

import { useState } from "react";
import { useI18n } from "./LanguageProvider";
import { AiBadge } from "./AiBadge";
import { Icon } from "./Icon";
import {
  LODGING,
  MEAL_MODES,
  MEALS,
  OVERRIDE_FIELDS,
  TRANSPORT,
  type Conditions,
  type Override,
  type OverrideField,
} from "@/lib/conditions";
import type { DictKey } from "@/lib/dictionaries";

/** Options for a field, with the dictionary key of each value. */
function optionsFor(field: OverrideField): { value: string; key: DictKey }[] {
  if (field === "lodging") return LODGING.map((v) => ({ value: v, key: `cond.lodging.${v}` as DictKey }));
  if (field === "transport") return TRANSPORT.map((v) => ({ value: v, key: `cond.transport.${v}` as DictKey }));
  return MEAL_MODES.map((v) => ({ value: v, key: `cond.mode.${v}` as DictKey }));
}

function fieldLabel(field: OverrideField): DictKey {
  return field === "lodging" || field === "transport" ? (`cond.${field}` as DictKey) : (`cond.meal.${field}` as DictKey);
}

/**
 * "How the AI understood your situation": shows the conditions used for the costs
 * and lets the user correct them; costs are then recalculated by the server (no AI call).
 */
export function ConditionsCard({
  conditions,
  days,
  fromText,
  busy,
  onRecalc,
}: {
  conditions: Conditions;
  days: number;
  fromText: boolean;
  busy: boolean;
  onRecalc: (c: Conditions) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Conditions>(conditions);

  const valueLabel = (field: OverrideField, value: string) =>
    t(optionsFor(field).find((o) => o.value === value)?.key ?? ("common.unknown" as DictKey));
  const dayLabel = (o: Override) => (o.field === "lodging" ? t("cond.night", { n: o.day }) : t("cond.day", { n: o.day }));

  function startEdit() {
    setDraft(structuredClone(conditions));
    setEditing(true);
  }

  function setOverride(i: number, patch: Partial<Override>) {
    setDraft((d) => {
      const overrides = d.overrides.map((o, j) => {
        if (j !== i) return o;
        const next = { ...o, ...patch };
        // Keep the value valid when the field changes.
        if (patch.field && !optionsFor(next.field).some((x) => x.value === next.value)) next.value = optionsFor(next.field)[0].value;
        return next;
      });
      return { ...d, overrides };
    });
  }

  const select = "input py-2 text-sm";

  return (
    <section className="card space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icon name="spark" className="h-5 w-5 text-accent" />
          {fromText ? t("cond.title") : t("cond.titleForm")}
        </h2>
        {!editing && (
          <button type="button" className="chip" onClick={startEdit}>
            {t("cond.edit")}
          </button>
        )}
      </div>
      {fromText && <AiBadge />}

      {!editing ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted">{t("cond.lodging")}</dt>
            <dd className="font-medium">{valueLabel("lodging", conditions.lodging)}</dd>
            <dt className="text-muted">{t("cond.transport")}</dt>
            <dd className="font-medium">{valueLabel("transport", conditions.transport)}</dd>
            {MEALS.map((m) => (
              <div key={m} className="contents">
                <dt className="text-muted">{t(`cond.meal.${m}` as DictKey)}</dt>
                <dd className="font-medium">{valueLabel(m, conditions.meals[m])}</dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("cond.exceptions")}</p>
            {conditions.overrides.length === 0 ? (
              <p className="text-muted">{t("cond.noExceptions")}</p>
            ) : (
              <ul className="space-y-1">
                {conditions.overrides.map((o) => (
                  <li key={`${o.day}:${o.field}`}>
                    <span className="font-medium">{dayLabel(o)}</span> · {t(fieldLabel(o.field))}: {valueLabel(o.field, o.value)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {conditions.notes.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("cond.notes")}</p>
              <ul className="list-disc space-y-0.5 ps-5">
                {conditions.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {(["lodging", "transport", ...MEALS] as OverrideField[]).map((f) => (
              <label key={f} className="block">
                <span className="mb-1 block text-xs text-muted">{t(fieldLabel(f))}</span>
                <select
                  className={select}
                  value={f === "lodging" ? draft.lodging : f === "transport" ? draft.transport : draft.meals[f as (typeof MEALS)[number]]}
                  onChange={(e) =>
                    setDraft((d) =>
                      f === "lodging"
                        ? { ...d, lodging: e.target.value as Conditions["lodging"] }
                        : f === "transport"
                          ? { ...d, transport: e.target.value as Conditions["transport"] }
                          : { ...d, meals: { ...d.meals, [f]: e.target.value } },
                    )
                  }
                >
                  {optionsFor(f).map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.key)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("cond.exceptions")}</p>
            {draft.overrides.map((o, i) => (
              <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-2 rounded-lg border border-line p-2 sm:grid-cols-[5rem_1fr_1fr_auto]">
                <select
                  className={select}
                  value={o.day}
                  onChange={(e) => setOverride(i, { day: Number(e.target.value) })}
                  aria-label={t("cond.day", { n: "" })}
                >
                  {Array.from({ length: o.field === "lodging" ? Math.max(1, days - 1) : days }, (_, k) => k + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <select
                  className={select}
                  value={o.field}
                  onChange={(e) => setOverride(i, { field: e.target.value as OverrideField })}
                >
                  {OVERRIDE_FIELDS.filter((f) => f !== "lodging" || days > 1).map((f) => (
                    <option key={f} value={f}>
                      {t(fieldLabel(f))}
                    </option>
                  ))}
                </select>
                <select className={`${select} col-span-2 sm:col-span-1`} value={o.value} onChange={(e) => setOverride(i, { value: e.target.value })}>
                  {optionsFor(o.field).map((x) => (
                    <option key={x.value} value={x.value}>
                      {t(x.key)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="col-span-2 text-start text-xs font-semibold text-danger-ink underline sm:col-span-1"
                  onClick={() => setDraft((d) => ({ ...d, overrides: d.overrides.filter((_, j) => j !== i) }))}
                >
                  {t("cond.remove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() =>
                setDraft((d) => ({ ...d, overrides: [...d.overrides, { day: 1, field: "transport", value: "public" }] }))
              }
            >
              <Icon name="plus" className="h-4 w-4" />
              {t("cond.add")}
            </button>
          </div>

          <p className="text-xs text-muted">{t("cond.recalcNote")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => {
                onRecalc(draft);
                setEditing(false);
              }}
            >
              {t("cond.recalc")}
            </button>
            <button type="button" className="chip" onClick={() => setEditing(false)}>
              {t("cond.cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

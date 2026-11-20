"use client";

import Link from "next/link";
import { useState } from "react";
import { usePlacesI18n } from "@/components/LanguageProvider";
import { AiBadge, UnverifiedTag } from "@/components/AiBadge";
import { Icon } from "@/components/Icon";
import { QualityCheck } from "@/components/QualityCheck";
import { errorKey, postJson } from "@/lib/client";
import { getPlace } from "@/lib/places";
import type { DictKey } from "@/lib/dictionaries";
import type { Cost, PlanValidation, Range } from "@/lib/planValidation";
import type { BudgetAdvice, Suggestion } from "@/lib/budgetAdvice";
import {
  DEFAULT_FORM,
  FOOD_FORM,
  LODGING,
  TRANSPORT,
  type Conditions,
  type FoodForm,
  type Lodging,
  type Transport,
} from "@/lib/conditions";
import { ConditionsCard } from "@/components/ConditionsCard";

const INTERESTS = ["nature", "hiking", "culture", "history", "food", "city", "winter", "relax", "photo", "family"] as const;
const CITIES = ["Almaty", "Qonaev", "Talgar", "Esik", "Saty"];
const MAX_TRAVELLERS = 20;

type Item = {
  time: string;
  placeId: string | null;
  meal: string | null;
  activity: string;
  transport: string;
  notes: string;
  costs: Cost[] | null;
};
type Day = {
  day: number;
  title: string;
  items: Item[];
  dayCosts: Cost[];
  perPerson: Range;
  group: Range;
  unknownCount: number;
};
type PlanResponse = {
  plan: { title: string; overview: string; days: Day[]; tips: string[]; warnings: string[] };
  totals: { perPerson: Range; group: Range; unknownCount: number };
  travellers: number;
  budget: number;
  validation: PlanValidation;
  budgetCheck?: { attempted: boolean; revised: boolean; original: Range; fits: boolean } | null;
  advice?: BudgetAdvice | null;
  conditions: Conditions;
  conditionsFromText: boolean;
  /** The AI route, sent back for recalculation when the user corrects the conditions. */
  aiPlan: unknown;
};

/** A choice group in the form (segmented chips). */
function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  prefix,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  prefix: string;
}) {
  const { t } = usePlacesI18n();
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} type="button" className="chip" aria-pressed={value === o} onClick={() => onChange(o)}>
            {t(`${prefix}.${o}` as DictKey)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function PlannerPage() {
  const { t, language, formatKzt, placeText, costLabel } = usePlacesI18n();
  const [days, setDays] = useState(3);
  const [travellers, setTravellers] = useState(1);
  const [budget, setBudget] = useState("100000");
  const [interests, setInterests] = useState<string[]>(["nature", "city"]);
  const [startCity, setStartCity] = useState("Almaty");
  const [extra, setExtra] = useState("");
  const [lodging, setLodging] = useState<Lodging>(DEFAULT_FORM.lodging);
  const [transport, setTransport] = useState<Transport>(DEFAULT_FORM.transport);
  const [food, setFood] = useState<FoodForm>(DEFAULT_FORM.food);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DictKey | null>(null);
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [recalcError, setRecalcError] = useState<DictKey | null>(null);
  const [recalculated, setRecalculated] = useState(false);

  /** Same route, corrected conditions: costs are recalculated by the server (no AI call). */
  async function recalc(conditions: Conditions) {
    if (!result) return;
    setRecalcBusy(true);
    setRecalcError(null);
    try {
      const data = await postJson<PlanResponse>("/api/plan/recalc", {
        aiPlan: result.aiPlan,
        conditions,
        days: result.validation.daysRequested,
        travellers: result.travellers,
        budget: result.budget,
      });
      setResult(data);
      setRecalculated(true);
    } catch (err) {
      setRecalcError(errorKey(err));
    } finally {
      setRecalcBusy(false);
    }
  }

  function toggle(i: string) {
    setInterests((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void run();
  }

  async function run() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setRecalculated(false);
    setRecalcError(null);
    try {
      const data = await postJson<PlanResponse>("/api/plan", {
        days,
        travellers,
        budget: Math.max(0, Number(budget) || 0),
        interests,
        startCity: startCity.trim() || "Almaty",
        extra: extra.trim(),
        language: language.name,
        lodging,
        transport,
        food,
      });
      setResult(data);
      requestAnimationFrame(() => document.getElementById("plan-result")?.scrollIntoView({ behavior: "smooth" }));
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setLoading(false);
    }
  }

  const range = (r: Range) =>
    r.max === 0 ? t("common.free") : r.min === r.max ? formatKzt(r.min) : `${formatKzt(r.min)} – ${formatKzt(r.max)}`;

  function costName(c: Cost, placeId: string | null) {
    if (c.source === "general") return costLabel(c.id);
    if (c.source === "condition") return t(`free.${c.id}` as DictKey);
    return (placeId && placeText(placeId).priceLabels[c.id]) || c.id;
  }

  function costLine(c: Cost, placeId: string | null, n: number) {
    const isFree = c.source === "condition";
    return (
      <li key={`${c.source}:${c.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Icon name={isFree ? "check" : "wallet"} className={`h-4 w-4 ${isFree ? "text-brand" : "text-accent"}`} />
        <span className="text-muted">
          {costName(c, placeId)}
          {c.km ? (
            <span className="tabular-nums"> ({t("planner.km", { km: c.km })})</span>
          ) : (
            c.qty > 1 && <span className="tabular-nums"> ×{c.qty}</span>
          )}
          :
        </span>
        <span className="font-semibold tabular-nums">{isFree ? formatKzt(0) : range(c.perPerson)}</span>
        {!c.verified && <UnverifiedTag />}
        {n > 1 && c.unit !== "person" && (
          <span className="w-full ps-6 text-xs text-muted">{t("planner.shared", { units: c.units })}</span>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">{t("planner.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("planner.subtitle")}</p>
      </header>

      <form onSubmit={submit} className="card space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Stepper label={t("planner.days")} value={days} min={1} max={10} onChange={setDays} />
          <Stepper label={t("planner.travellers")} value={travellers} min={1} max={MAX_TRAVELLERS} onChange={setTravellers} />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">{t("planner.budget")}</span>
          <input
            className="input tabular-nums"
            inputMode="numeric"
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/\D/g, "").slice(0, 9))}
            required
          />
          {travellers > 1 && Number(budget) > 0 && (
            <span className="mt-1 block text-xs text-muted">
              {t("planner.groupBudget")}: {formatKzt(Number(budget) * travellers)}
            </span>
          )}
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium">{t("planner.interests")}</span>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((i) => (
              <button
                key={i}
                type="button"
                className="chip"
                aria-pressed={interests.includes(i)}
                onClick={() => toggle(i)}
              >
                {t(`interest.${i}` as DictKey)}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">{t("planner.startCity")}</span>
          <input
            className="input"
            list="cities"
            value={startCity}
            maxLength={60}
            onChange={(e) => setStartCity(e.target.value)}
          />
          <datalist id="cities">
            {CITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <ChoiceGroup label={t("cond.lodging")} options={LODGING} value={lodging} onChange={setLodging} prefix="cond.lodging" />
        <ChoiceGroup
          label={t("cond.transport")}
          options={TRANSPORT}
          value={transport}
          onChange={setTransport}
          prefix="cond.transport"
        />
        <ChoiceGroup label={t("cond.food")} options={FOOD_FORM} value={food} onChange={setFood} prefix="cond.food" />
        <p className="text-xs text-muted">{t("cond.textWins")}</p>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">{t("planner.extra")}</span>
          <textarea
            className="input min-h-20 resize-y"
            value={extra}
            maxLength={300}
            onChange={(e) => setExtra(e.target.value)}
            placeholder={t("planner.extraPlaceholder")}
          />
        </label>

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t("planner.generating")}
            </>
          ) : (
            <>
              <Icon name="spark" className="h-4 w-4" />
              {t("planner.generate")}
            </>
          )}
        </button>
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-ink"
          >
            <span>{t(error)}</span>
            {error !== "errors.noKey" && (
              <button type="button" onClick={() => void run()} className="font-semibold underline">
                {t("common.retry")}
              </button>
            )}
          </div>
        )}
      </form>

      {loading && (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="card h-40 animate-pulse bg-surface-2" />
          ))}
        </div>
      )}

      {result && (
        <section id="plan-result" className="scroll-mt-20 space-y-4">
          <ConditionsCard
            key={JSON.stringify(result.conditions)}
            conditions={result.conditions}
            days={result.validation.daysRequested}
            fromText={result.conditionsFromText}
            busy={recalcBusy}
            onRecalc={recalc}
          />
          {recalcBusy && <p className="text-sm text-muted">{t("common.loading")}</p>}
          {recalculated && !recalcBusy && (
            <p role="status" className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">
              {t("cond.recalculated")}
            </p>
          )}
          {recalcError && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-ink">
              {t(recalcError)}
            </p>
          )}

          <div className="card space-y-3 p-4">
            <AiBadge />
            <h2 className="text-xl font-bold">{result.plan.title}</h2>
            <p className="text-sm text-muted">{result.plan.overview}</p>
          </div>

          <BudgetSummary result={result} range={range} />

          {result.plan.days.map((d) => (
            <article key={d.day} className="card overflow-hidden">
              <header className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-3">
                <h3 className="font-semibold">
                  <span className="text-brand">{t("planner.day", { n: d.day })}</span> · {d.title}
                </h3>
              </header>
              <ol className="divide-y divide-line">
                {d.items.map((it, idx) => {
                  const place = it.placeId ? getPlace(it.placeId) : undefined;
                  const pt = it.placeId ? placeText(it.placeId) : undefined;
                  return (
                    <li key={idx} className="space-y-1.5 px-4 py-3">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-xs font-semibold text-brand tabular-nums">
                          {it.time}
                        </span>
                        <p className="font-medium">
                          {place && pt ? (
                            <Link href={`/places/${place.id}`} className="text-brand underline-offset-2 hover:underline">
                              {pt.name}
                            </Link>
                          ) : null}
                          {place ? " — " : ""}
                          {it.activity}
                        </p>
                      </div>
                      {it.transport && (
                        <p className="flex gap-1.5 text-sm text-muted">
                          <Icon name="car" className="mt-0.5 h-4 w-4 shrink-0" />
                          {it.transport}
                        </p>
                      )}
                      {it.notes && <p className="text-sm text-muted">{it.notes}</p>}
                      <div className="text-sm">
                        {it.costs ? (
                          <ul className="space-y-1">
                            {it.costs.map((c) => (
                              costLine(c, it.placeId, result.travellers)
                            ))}
                          </ul>
                        ) : (
                          <p className="flex items-center gap-2 text-muted">
                            <Icon name="wallet" className="h-4 w-4" />
                            {t("planner.costUnknown")}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {d.dayCosts?.length > 0 && (
                <div className="border-t border-line px-4 py-3 text-sm">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t("planner.dayCosts")}</p>
                  <ul className="space-y-1">
                    {d.dayCosts.map((c) => (
                      costLine(c, null, result.travellers)
                    ))}
                  </ul>
                </div>
              )}
              <footer className="space-y-1 border-t border-line px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted">
                    {t("planner.dayTotal")} · {t("planner.perPerson").toLowerCase()}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {range(d.perPerson)}
                    {d.unknownCount > 0 && (
                      <span className="ms-2 font-normal text-muted">
                        + {t("common.unknown")} ({d.unknownCount})
                      </span>
                    )}
                  </span>
                </div>
                {result.travellers > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-muted">
                    <span>{t("planner.groupOf", { n: result.travellers })}</span>
                    <span className="tabular-nums">{range(d.group)}</span>
                  </div>
                )}
              </footer>
            </article>
          ))}

          {result.plan.warnings.length > 0 && (
            <ListCard icon="alert" title={t("planner.warnings")} items={result.plan.warnings} tone="warn" />
          )}
          {result.plan.tips.length > 0 && <ListCard icon="bulb" title={t("planner.tips")} items={result.plan.tips} />}

          <QualityCheck v={result.validation} />

          <AiBadge />
          <button
            type="button"
            className="chip"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            {t("planner.edit")}
          </button>
        </section>
      )}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex items-center rounded-xl border border-line bg-surface">
        <button
          type="button"
          className="px-3.5 py-2.5 text-lg text-muted disabled:opacity-40"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`${label} −`}
        >
          −
        </button>
        <span className="flex-1 text-center font-semibold tabular-nums" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="px-3.5 py-2.5 text-lg text-muted disabled:opacity-40"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`${label} +`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function BudgetSummary({ result, range }: { result: PlanResponse; range: (r: Range) => string }) {
  const { t, formatKzt } = usePlacesI18n();
  const { totals, budget, travellers } = result;
  const over = totals.perPerson.min > budget;
  return (
    <div className="card space-y-3 p-4 text-sm">
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("planner.perPerson")}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">{t("planner.tripTotal")}</span>
          <span className="text-base font-bold tabular-nums">{range(totals.perPerson)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">{t("planner.budgetLabel")}</span>
          <span className="font-semibold tabular-nums">{formatKzt(budget)}</span>
        </div>
      </div>

      {travellers > 1 && (
        <div className="space-y-1.5 border-t border-line pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("planner.groupOf", { n: travellers })}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted">{t("planner.tripTotal")}</span>
            <span className="text-base font-bold tabular-nums">{range(totals.group)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted">{t("planner.groupBudget")}</span>
            <span className="font-semibold tabular-nums">{formatKzt(budget * travellers)}</span>
          </div>
        </div>
      )}

      {totals.unknownCount > 0 && (
        <p className="text-muted">{t("planner.unknownItems", { n: totals.unknownCount })}</p>
      )}

      {result.budgetCheck?.attempted && (
        <p className="flex gap-2 rounded-lg bg-accent-soft px-3 py-2 text-accent">
          <Icon name="spark" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {result.budgetCheck.revised
              ? t(result.budgetCheck.fits ? "budget.revisedFits" : "budget.revised", {
                  from: range(result.budgetCheck.original),
                  to: range(totals.perPerson),
                })
              : t("budget.notCheaper")}
          </span>
        </p>
      )}

      <p className={`rounded-lg px-3 py-2 ${over ? "bg-danger-soft text-danger-ink" : "bg-brand-soft text-brand"}`}>
        {over
          ? t("planner.overBudget")
          : t("planner.withinBudget", { amount: formatKzt(Math.max(0, budget - totals.perPerson.min)) })}
      </p>

      {over && result.advice && <AdviceCard advice={result.advice} />}
      <p className="text-xs text-muted">{t("planner.notIncluded")}</p>
      <p className="text-xs text-muted">{t("planner.costSource")}</p>
    </div>
  );
}

function AdviceCard({ advice }: { advice: BudgetAdvice }) {
  const { t, formatKzt, placeText } = usePlacesI18n();
  const text = (s: Suggestion) => {
    const amount = formatKzt(s.saving);
    switch (s.kind) {
      case "fewerDays":
        return t("budget.tip.fewerDays", { n: s.day, amount });
      case "skipPaid":
        return t("budget.tip.skipPaid", { place: placeText(s.placeId)?.name ?? s.placeId, amount });
      default:
        return t(`budget.tip.${s.kind}` as DictKey, { amount });
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="font-semibold">{t("budget.minimum", { amount: formatKzt(advice.minBudget) })}</p>
      {advice.suggestions.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("budget.waysTitle")}</p>
          <ul className="space-y-1.5">
            {advice.suggestions.map((s) => (
              <li key={s.kind} className="flex gap-2">
                <Icon name="bulb" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>{text(s)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-muted">{t("budget.calcNote")}</p>
    </div>
  );
}

function ListCard({
  icon,
  title,
  items,
  tone,
}: {
  icon: string;
  title: string;
  items: string[];
  tone?: "warn";
}) {
  return (
    <div className={`card p-4 ${tone === "warn" ? "bg-warn-soft" : ""}`}>
      <h3 className={`mb-2 flex items-center gap-2 font-semibold ${tone === "warn" ? "text-warn-ink" : ""}`}>
        <Icon name={icon} className="h-5 w-5" />
        {title}
      </h3>
      <ul className="list-disc space-y-1 ps-5 text-sm">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

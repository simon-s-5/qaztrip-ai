/**
 * Budget advice for a validated plan: minimum budget and concrete ways to save.
 * Calculated by the server from our databases (not by the AI). Pure, unit-tested:
 * see tests/budgetAdvice.test.mts.
 */
import { amount, type Cost, type Range } from "./planValidation.ts";
import type { GeneralCost } from "./costs";

export type AdvicePlanDay = {
  day: number;
  perPerson: Range;
  items: { placeId: string | null; costs: Cost[] | null }[];
  /** Day-level costs added by the server from the conditions (lodging, car, fuel, groceries). */
  dayCosts?: Cost[];
};

export type Suggestion =
  | { kind: "hostel"; saving: number }
  | { kind: "publicTransport"; saving: number }
  | { kind: "canteen"; saving: number }
  | { kind: "fewerDays"; saving: number; day: number }
  | { kind: "skipPaid"; saving: number; placeId: string };

export type BudgetAdvice = {
  /** Lowest budget per person that covers the known costs of this route (rounded up). */
  minBudget: number;
  suggestions: Suggestion[];
};

/** Known costs are over budget when even the lower bound is above it. */
export function isOverBudget(perPerson: Range, budget: number): boolean {
  return perPerson.min > budget;
}

const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;

/** Saving per person when every `fromId` general cost is replaced by `toId` (same quantity). */
function swapSaving(days: AdvicePlanDay[], costs: GeneralCost[], fromId: string, toId: string, travellers: number) {
  const to = costs.find((c) => c.id === toId);
  if (!to) return 0;
  let saving = 0;
  for (const d of days)
    for (const c of [...d.items.flatMap((it) => it.costs ?? []), ...(d.dayCosts ?? [])]) {
      if (c.source !== "general" || c.id !== fromId) continue;
      const cheaper = amount(to, to.unit, to.capacity, c.qty, travellers).perPerson.min;
      saving += Math.max(0, c.perPerson.min - cheaper);
    }
  return saving;
}

export function budgetAdvice(
  days: AdvicePlanDay[],
  totalPerPerson: Range,
  costs: GeneralCost[],
  travellers: number,
  max = 3,
  /** Explicit wishes are not suggested for replacement here: their cost is shown separately (lib/wishes.ts). */
  wishes: { locked?: readonly string[]; wishPlaces?: readonly string[] } = {},
): BudgetAdvice {
  const locked = new Set(wishes.locked ?? []);
  const wishPlaces = new Set(wishes.wishPlaces ?? []);
  const all: Suggestion[] = [];
  if (!locked.has("lodging")) all.push({ kind: "hostel", saving: swapSaving(days, costs, "hotel-mid", "hostel", travellers) });
  if (!locked.has("transport"))
    all.push({ kind: "publicTransport", saving: swapSaving(days, costs, "taxi-city", "bus", travellers) });
  if (!locked.has("mealPlace"))
    all.push({ kind: "canteen", saving: swapSaving(days, costs, "meal-cafe", "meal-canteen", travellers) });

  // One day shorter: drop the most expensive day.
  if (days.length > 1) {
    const top = days.reduce((a, b) => (b.perPerson.min > a.perPerson.min ? b : a));
    all.push({ kind: "fewerDays", saving: top.perPerson.min, day: top.day });
  }

  // The most expensive paid place (entry, tour, gondola…): replace it with a free place.
  let best: { placeId: string; saving: number } | null = null;
  for (const d of days)
    for (const it of d.items) {
      if (!it.placeId || wishPlaces.has(it.placeId)) continue;
      const s = (it.costs ?? []).filter((c) => c.source === "place").reduce((a, c) => a + c.perPerson.min, 0);
      if (s > 0 && (!best || s > best.saving)) best = { placeId: it.placeId, saving: s };
    }
  if (best) all.push({ kind: "skipPaid", saving: best.saving, placeId: best.placeId });

  const suggestions = all
    .filter((s) => s.saving > 0)
    .map((s) => ({ ...s, saving: roundUp(s.saving, 100) }))
    .sort((a, b) => b.saving - a.saving)
    .slice(0, max);

  return { minBudget: roundUp(totalPerPerson.min, 1000), suggestions };
}

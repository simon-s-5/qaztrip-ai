/**
 * Explicit wishes vs the budget. Pure logic, unit-tested: see tests/wishes.test.mts.
 *
 * - Things the traveller did NOT ask for may be made cheaper by the server (cheapenUnlocked).
 * - Explicit wishes are never replaced. If the route is over budget, we show what each wish
 *   costs compared with the cheapest alternative (wishCosts) — the traveller decides.
 * All amounts come from `evaluate`, i.e. the server's own cost calculation for given conditions.
 */
import type { Conditions, Lockable, Override } from "./conditions";

/** Known cost per person (lower bound) of the same route under the given conditions. */
export type Evaluate = (c: Conditions) => number;

/** Realistic alternatives: we never assume relatives to stay with or an own car. */
const ALTERNATIVES: Record<Lockable, readonly string[]> = {
  lodging: ["hostel", "apartment", "hotel"],
  transport: ["public", "taxi", "rental"],
  mealPlace: ["canteen", "cafe"],
};

export type AutoChoice = { field: Lockable; from: string; to: string; saving: number };

export type WishCost = {
  /** Base field, an exception ("override") or a wished place. */
  kind: Lockable | "override" | "place";
  /** For "override": the day and the field of the exception. */
  day?: number;
  field?: string;
  /** The wish (value or place id) and the cheapest alternative ("free-place" for places). */
  wish: string;
  alternative: string;
  /** Per person: saving with the alternative, and how far the route is over budget. */
  saving: number;
  over: number;
  fitsAfter: boolean;
};

const roundUp = (n: number, step = 100) => Math.ceil(n / step) * step;

function cheapestAlternative(c: Conditions, field: Lockable, evaluate: Evaluate) {
  const current = c[field] as string;
  let best = { value: current, cost: evaluate(c) };
  for (const alt of ALTERNATIVES[field]) {
    if (alt === current) continue;
    const cost = evaluate({ ...c, [field]: alt } as Conditions);
    if (cost < best.cost) best = { value: alt, cost };
  }
  return best;
}

/**
 * Over budget: make every NOT-explicit base field as cheap as possible.
 * Lodging "free" (relatives / own home) and transport "own" are facts, not choices: kept.
 */
export function cheapenUnlocked(c: Conditions, evaluate: Evaluate): { conditions: Conditions; changes: AutoChoice[] } {
  let cur = c;
  const changes: AutoChoice[] = [];
  for (const field of ["lodging", "transport", "mealPlace"] as const) {
    if (cur.locked.includes(field)) continue;
    if (field === "lodging" && cur.lodging === "free") continue;
    if (field === "transport" && cur.transport === "own") continue;
    // A private local driver is the main nature-trip scenario: never swapped for a self-drive rental behind the traveller's back.
    if (field === "transport" && cur.transport === "driver") continue;
    const before = evaluate(cur);
    const best = cheapestAlternative(cur, field, evaluate);
    if (best.value !== cur[field] && best.cost < before) {
      changes.push({ field, from: cur[field], to: best.value, saving: roundUp(before - best.cost) });
      cur = { ...cur, [field]: best.value } as Conditions;
    }
  }
  return { conditions: cur, changes };
}

function withOverride(c: Conditions, i: number, value: string): Conditions {
  return { ...c, overrides: c.overrides.map((o, j): Override => (j === i ? { ...o, value } : o)) };
}

/**
 * What each explicit wish costs when the route is over budget.
 * `placeCosts`: per-person cost of each wished place in the current route (from the server's calculation).
 */
export function wishCosts(
  c: Conditions,
  evaluate: Evaluate,
  budget: number,
  placeCosts: Record<string, number> = {},
): WishCost[] {
  const current = evaluate(c);
  if (current <= budget) return [];
  const over = roundUp(current - budget);
  const out: WishCost[] = [];
  const push = (w: Omit<WishCost, "over" | "fitsAfter" | "saving"> & { saving: number }) => {
    if (w.saving <= 0) return;
    out.push({ ...w, saving: roundUp(w.saving), over, fitsAfter: current - w.saving <= budget });
  };

  for (const field of c.locked) {
    const best = cheapestAlternative(c, field, evaluate);
    if (best.value !== c[field]) push({ kind: field, wish: String(c[field]), alternative: best.value, saving: current - best.cost });
  }

  c.overrides.forEach((o, i) => {
    if (o.field !== "lodging" && o.field !== "transport") return; // meals as guests / self-cooked are already cheapest
    let best = { value: o.value, cost: current };
    for (const alt of ALTERNATIVES[o.field]) {
      if (alt === o.value) continue;
      const cost = evaluate(withOverride(c, i, alt));
      if (cost < best.cost) best = { value: alt, cost };
    }
    if (best.value !== o.value)
      push({ kind: "override", day: o.day, field: o.field, wish: o.value, alternative: best.value, saving: current - best.cost });
  });

  for (const placeId of c.wishPlaces) {
    const saving = placeCosts[placeId] ?? 0;
    push({ kind: "place", wish: placeId, alternative: "free-place", saving });
  }

  return out.sort((a, b) => b.saving - a.saving);
}

/**
 * Guard for the AI's budget re-planning: wished places that were in the first route
 * must still be in the revised route; otherwise the revision is rejected.
 */
export function keepsWishPlaces(
  first: { days: { items: { placeId: string }[] }[] },
  revised: { days: { items: { placeId: string }[] }[] },
  wishPlaces: readonly string[],
): boolean {
  const ids = (p: typeof first) => new Set(p.days.flatMap((d) => d.items.map((i) => i.placeId)));
  const a = ids(first);
  const b = ids(revised);
  return wishPlaces.every((w) => !a.has(w) || b.has(w));
}

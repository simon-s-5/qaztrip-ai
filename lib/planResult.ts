import "server-only";
import { PLACES } from "./places";
import { COSTS } from "./costs";
import { DRIVERS } from "./drivers";
import { validatePlan, type AiPlan } from "./planValidation";
import { resolveConditions, type Conditions } from "./conditions";
import { budgetAdvice, isOverBudget } from "./budgetAdvice";
import { cheapenUnlocked, wishCosts, type AutoChoice } from "./wishes";

export const DB = { places: PLACES, costs: COSTS, drivers: DRIVERS };

type Calc = { days: number; travellers: number };

/** Server-side calculation shared by /api/plan (after the AI) and /api/plan/recalc (no AI). */
export function computePlan(aiPlan: AiPlan, conditions: Conditions, input: Calc) {
  const dayConditions = resolveConditions(conditions, input.days);
  return validatePlan(aiPlan, DB, { days: input.days, travellers: input.travellers, conditions: dayConditions });
}

type Result = ReturnType<typeof computePlan>;

const evaluator = (aiPlan: AiPlan, calc: Calc) => (c: Conditions) => computePlan(aiPlan, c, calc).totals.perPerson.min;

/**
 * Over budget → make everything the traveller did NOT explicitly ask for as cheap as possible
 * (deterministic, no AI). Explicit wishes are kept.
 */
export function fitUnlocked(aiPlan: AiPlan, conditions: Conditions, calc: Calc, budget: number) {
  const first = computePlan(aiPlan, conditions, calc);
  if (!isOverBudget(first.totals.perPerson, budget)) return { conditions, result: first, autoChoices: [] as AutoChoice[] };
  const { conditions: cheaper, changes } = cheapenUnlocked(conditions, evaluator(aiPlan, calc));
  if (changes.length === 0) return { conditions, result: first, autoChoices: changes };
  return { conditions: cheaper, result: computePlan(aiPlan, cheaper, calc), autoChoices: changes };
}

/** Per-person cost of each wished place in the route (place prices only). */
function wishPlaceCosts(result: Result, wishPlaces: string[]) {
  const out: Record<string, number> = {};
  for (const d of result.plan.days)
    for (const it of d.items) {
      if (!it.placeId || !wishPlaces.includes(it.placeId)) continue;
      const s = (it.costs ?? []).filter((c) => c.source === "place").reduce((a, c) => a + c.perPerson.min, 0);
      out[it.placeId] = (out[it.placeId] ?? 0) + s;
    }
  return out;
}

/** Still over budget → what each explicit wish costs + minimum budget and other ways to save. */
export function budgetHelp(aiPlan: AiPlan, conditions: Conditions, calc: Calc, result: Result, budget: number) {
  if (!isOverBudget(result.totals.perPerson, budget)) return { wishCosts: [], advice: null };
  return {
    wishCosts: wishCosts(conditions, evaluator(aiPlan, calc), budget, wishPlaceCosts(result, conditions.wishPlaces)),
    advice: budgetAdvice(result.plan.days, result.totals.perPerson, COSTS, result.travellers, 3, {
      locked: conditions.locked,
      wishPlaces: conditions.wishPlaces,
    }),
  };
}

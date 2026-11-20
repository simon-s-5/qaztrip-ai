import "server-only";
import { PLACES } from "./places";
import { COSTS } from "./costs";
import { validatePlan, type AiPlan } from "./planValidation";
import { resolveConditions, type Conditions } from "./conditions";
import { budgetAdvice, isOverBudget } from "./budgetAdvice";

export const DB = { places: PLACES, costs: COSTS };

/** Server-side calculation shared by /api/plan (after the AI) and /api/plan/recalc (no AI). */
export function computePlan(aiPlan: AiPlan, conditions: Conditions, input: { days: number; travellers: number }) {
  const dayConditions = resolveConditions(conditions, input.days);
  return validatePlan(aiPlan, DB, { days: input.days, travellers: input.travellers, conditions: dayConditions });
}

export function adviceFor(result: ReturnType<typeof computePlan>, budget: number) {
  return isOverBudget(result.totals.perPerson, budget)
    ? budgetAdvice(result.plan.days, result.totals.perPerson, COSTS, result.travellers)
    : null;
}

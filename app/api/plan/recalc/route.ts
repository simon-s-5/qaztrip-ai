import { z } from "zod";
import { MAX_TRAVELLERS } from "@/lib/planValidation";
import { AiPlanZ } from "@/lib/planSchema";
import { DEFAULT_FORM, formToConditions, sanitizeConditions } from "@/lib/conditions";
import { adviceFor, computePlan } from "@/lib/planResult";
import { apiError, checkLimit } from "@/lib/api";

/**
 * Recalculates the costs of an existing route after the user corrected "how the AI understood
 * your situation". No AI call: the same route, new conditions, server-side calculation only.
 */
const Body = z.object({
  aiPlan: AiPlanZ,
  conditions: z.unknown(),
  days: z.number().int().min(1).max(10),
  travellers: z.number().int().min(1).max(MAX_TRAVELLERS),
  budget: z.number().min(0).max(100_000_000),
});

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, "bad_request", "Invalid input");
  const limited = checkLimit(req, "recalc", 30, 500);
  if (limited) return limited;

  const { aiPlan, days, travellers, budget } = body.data;
  const conditions = sanitizeConditions(body.data.conditions, days, formToConditions(DEFAULT_FORM));
  const result = computePlan(aiPlan, conditions, { days, travellers });
  return Response.json({
    ...result,
    budget,
    budgetCheck: null,
    advice: adviceFor(result, budget),
    conditions,
    conditionsFromText: false,
    aiPlan,
  });
}

import { z } from "zod";
import { geminiJson, MissingKeyError } from "@/lib/gemini";
import { placesForPrompt } from "@/lib/places";
import { costsForPrompt } from "@/lib/costs";
import { MAX_TRAVELLERS } from "@/lib/planValidation";
import { AiAnswerZ, PLAN_JSON_SCHEMA } from "@/lib/planSchema";
import { chooseConditions, FOOD_FORM, formToConditions, LODGING, TRANSPORT, type Conditions } from "@/lib/conditions";
import { adviceFor, computePlan } from "@/lib/planResult";
import { isOverBudget } from "@/lib/budgetAdvice";
import { recordBudgetCheck, recordPlan, recordPlanError } from "@/lib/metrics";
import { apiError, checkLimit, handleAiError, LANGUAGE_RE } from "@/lib/api";

export const maxDuration = 60;

/** Time plan inside the 60 s limit: first AI call ≤ 34 s, one re-planning call only if ≥ 12 s are left. */
const TOTAL_MS = 56_000;
const FIRST_CALL_MS = 34_000;
const MIN_REVISION_MS = 12_000;

const INTERESTS = ["nature", "hiking", "culture", "history", "food", "city", "winter", "relax", "photo", "family"] as const;

const Body = z.object({
  days: z.number().int().min(1).max(10),
  budget: z.number().min(0).max(100_000_000),
  travellers: z.number().int().min(1).max(MAX_TRAVELLERS).optional().default(1),
  interests: z.array(z.enum(INTERESTS)).max(10),
  extra: z.string().max(300).optional().default(""),
  startCity: z.string().trim().min(1).max(60),
  language: z.string().trim().regex(LANGUAGE_RE),
  lodging: z.enum(LODGING).optional().default("hotel"),
  transport: z.enum(TRANSPORT).optional().default("public"),
  food: z.enum(FOOD_FORM).optional().default("buy"),
});

function describe(c: Conditions) {
  return `lodging=${c.lodging}; transport=${c.transport}; breakfast=${c.meals.breakfast}; lunch=${c.meals.lunch}; dinner=${c.meals.dinner}`;
}

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, "bad_request", "Invalid input");
  const limited = checkLimit(req, "plan", 4, 40);
  if (limited) return limited;

  const input = body.data;
  const hasText = input.extra.trim().length > 0;
  const formConditions = formToConditions({ lodging: input.lodging, transport: input.transport, food: input.food });
  const month = new Date().toLocaleString("en", { month: "long", timeZone: "Asia/Almaty" });

  const system = `You are Sapar AI, a careful travel planner for Almaty city and the Almaty region of Kazakhstan.
STEP 1 — the traveller's situation ("conditions"):
- Start from FORM CONDITIONS. Then apply the traveller's free text (EXTRA WISHES) on top: if the text contradicts the form, THE TEXT WINS.
- Values: lodging = hotel | hostel | free (staying with relatives or at own home, 0 ₸) | apartment (rented flat);
  transport = public | taxi | rental (rented car) | own (own car); each meal = buy | guest (eaten at relatives/hosts, 0 ₸) | self (cooked themselves).
- Something that applies to all days goes into the base values; something for specific days only goes into "overrides"
  (e.g. "we rent a car on day 3" → {day: 3, field: "transport", value: "rental"}; "dinner at my aunt's on day 2" → {day: 2, field: "dinner", value: "guest"};
  "we always have dinner at relatives" → meals.dinner = "guest"). Lodging on day N means the night after day N.
- "notes": other wishes you understood from the text, very short, in ${input.language}. Empty if there is no text.
STEP 2 — the plan (follow the conditions):
1. For sightseeing use ONLY places from DATABASE, referenced by "placeId". For other items (meals, transfers, rest) use placeId "none".
2. NEVER write prices, costs, amounts of money or currencies in any text field. All costs are calculated by our server.
3. "priceIds": only price ids of that place from DATABASE that the traveller will pay (e.g. entry, gondola). Empty if none apply.
4. Mark every breakfast, lunch and dinner item with "meal". For meals that are bought, add meal-canteen or meal-cafe in "generalCosts".
   For meals as guests or self-cooked, add no meal cost.
5. For city rides add metro, bus or taxi-city in "generalCosts" with qty = number of rides (one per direction), matching the day's transport.
   Mark items that are mainly travelling between places with "isTransfer": true (on car days too).
   Do NOT add lodging, car rental, fuel or groceries — the server adds them from the conditions.
6. A place visit that is a tour already includes its transport.
7. Be realistic about distance and time: places over 150 km from Almaty usually need a full day or an overnight stay.
8. Current month is ${month}. Respect each place's season and add a warning if a place is out of season.
9. If you are not sure about a fact, say it is unknown instead of guessing.
10. Write ALL text in ${input.language}.`;

  const prompt = `DATABASE (places):\n${JSON.stringify(placesForPrompt())}

GENERAL COSTS:\n${JSON.stringify(costsForPrompt())}

TRAVELLERS:
- Group size: ${input.travellers} ${input.travellers === 1 ? "person" : "people travelling together"}
- Days: ${input.days}
- Budget per person: ${input.budget} KZT
- Interests: ${input.interests.join(", ") || "any"}
- Starting city: ${input.startCity}

FORM CONDITIONS: ${describe(formConditions)}
EXTRA WISHES (free text, wins over the form): ${hasText ? input.extra : "none"}

Return exactly ${input.days} days.`;

  const calc = { days: input.days, travellers: input.travellers };
  const started = Date.now();

  try {
    // 1) AI: conditions from form + text, and the plan. Parsed inside the retry loop (malformed → next model).
    const ai = await geminiJson({
      system,
      prompt,
      schema: PLAN_JSON_SCHEMA,
      parse: (d) => AiAnswerZ.parse(d),
      limits: { budgetMs: FIRST_CALL_MS, attemptTimeoutMs: 20_000 },
    });
    const { conditions: aiConditions, ...firstPlan } = ai.data;

    // Without free text the form is the source of truth; with text, the AI's interpretation (text wins).
    const conditions = chooseConditions(formConditions, aiConditions, hasText, input.days);

    // 2) Server: validate against the databases and calculate costs from the conditions.
    let aiPlan = firstPlan;
    let result = computePlan(aiPlan, conditions, calc);
    let model = ai.model;
    let fallback = ai.fallback;
    const original = result.totals.perPerson;
    const budgetCheck = { attempted: false, revised: false, original, fits: !isOverBudget(original, input.budget) };

    // 3) Over budget → one feedback round: the AI re-plans once with cheaper options. No loops.
    const remaining = TOTAL_MS - (Date.now() - started);
    if (!budgetCheck.fits && remaining >= MIN_REVISION_MS) {
      budgetCheck.attempted = true;
      try {
        const feedback = `FEEDBACK FROM OUR SERVER: the known cost of your plan is ${original.min}–${original.max} KZT per person, calculated from our databases. The budget is ${input.budget} KZT per person.
Re-plan the trip to fit the budget: choose cheaper options — free places instead of paid tours and tickets, canteen instead of café for bought meals, metro/bus instead of taxi where the day's transport allows it.
Keep the traveller's requirements: exactly ${input.days} days, the group size, the interests, the extra wishes and these CONDITIONS (return them unchanged): ${JSON.stringify(conditions)}.
Follow all the RULES. Return the complete revised plan.`;
        const second = await geminiJson({
          system,
          prompt: `${prompt}\n\nYOUR PREVIOUS PLAN:\n${JSON.stringify(firstPlan)}\n\n${feedback}`,
          schema: PLAN_JSON_SCHEMA,
          parse: (d) => AiAnswerZ.parse(d),
          preferModel: ai.model,
          limits: { budgetMs: remaining - 2_000, attemptTimeoutMs: Math.min(20_000, remaining - 2_000), maxAttempts: 2 },
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { conditions: _ignored, ...secondPlan } = second.data;
        const revised = computePlan(secondPlan, conditions, calc); // conditions stay fixed
        // Accept the new plan only if it is really cheaper.
        if (revised.totals.perPerson.min < original.min) {
          aiPlan = secondPlan;
          result = revised;
          model = second.model;
          fallback = second.fallback;
          budgetCheck.revised = true;
          budgetCheck.fits = !isOverBudget(revised.totals.perPerson, input.budget);
        }
      } catch (e) {
        if (e instanceof MissingKeyError) throw e;
        console.warn("Budget re-planning failed, keeping the first plan");
      }
    }
    recordBudgetCheck(budgetCheck);

    // 4) Still over budget → minimum budget and concrete ways to save (calculated by the server).
    const advice = budgetCheck.fits ? null : adviceFor(result, input.budget);

    recordPlan(result.validation, fallback);
    return Response.json({
      ...result,
      budget: input.budget,
      model,
      fallback,
      budgetCheck,
      advice,
      conditions,
      conditionsFromText: hasText,
      // Sent back by the browser to recalculate costs when the user corrects the conditions (no AI call).
      aiPlan,
    });
  } catch (e) {
    if (!(e instanceof MissingKeyError)) recordPlanError();
    return handleAiError(e);
  }
}

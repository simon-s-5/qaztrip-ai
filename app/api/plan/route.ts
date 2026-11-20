import { z } from "zod";
import { geminiJson, MissingKeyError } from "@/lib/gemini";
import { PLACES, PLACE_IDS, placesForPrompt } from "@/lib/places";
import { COSTS, COST_IDS, costsForPrompt } from "@/lib/costs";
import { MAX_QTY, MAX_TRAVELLERS, validatePlan } from "@/lib/planValidation";
import { recordBudgetCheck, recordPlan, recordPlanError } from "@/lib/metrics";
import { budgetAdvice, isOverBudget } from "@/lib/budgetAdvice";
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
});

const str = { type: "string" };
const SCHEMA = {
  type: "object",
  properties: {
    title: str,
    overview: str,
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "integer" },
          title: str,
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time: { type: "string", description: "e.g. 09:00 or Morning" },
                placeId: { type: "string", enum: [...PLACE_IDS, "none"] },
                activity: str,
                transport: { type: "string", description: "How to get there, no prices" },
                notes: str,
                priceIds: {
                  type: "array",
                  items: str,
                  description: "Ids from this place's database prices that apply to this visit",
                },
                generalCosts: {
                  type: "array",
                  description: "General costs from GENERAL COSTS paid for this item, with a count",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", enum: COST_IDS },
                      qty: {
                        type: "integer",
                        minimum: 1,
                        maximum: MAX_QTY,
                        description: "Number of rides, meals or nights (not money)",
                      },
                    },
                    required: ["id", "qty"],
                  },
                },
              },
              required: ["time", "placeId", "activity", "transport", "notes", "priceIds", "generalCosts"],
            },
          },
        },
        required: ["day", "title", "items"],
      },
    },
    tips: { type: "array", items: str },
    warnings: { type: "array", items: str },
  },
  required: ["title", "overview", "days", "tips", "warnings"],
};

const AiPlan = z.object({
  title: z.string(),
  overview: z.string(),
  days: z.array(
    z.object({
      day: z.number(),
      title: z.string(),
      items: z.array(
        z.object({
          time: z.string(),
          placeId: z.string(),
          activity: z.string(),
          transport: z.string(),
          notes: z.string(),
          priceIds: z.array(z.string()),
          generalCosts: z.array(z.object({ id: z.string(), qty: z.number() })).catch([]),
        }),
      ),
    }),
  ),
  tips: z.array(z.string()),
  warnings: z.array(z.string()),
});

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, "bad_request", "Invalid input");
  const limited = checkLimit(req, "plan", 4, 40);
  if (limited) return limited;

  const input = body.data;
  const month = new Date().toLocaleString("en", { month: "long", timeZone: "Asia/Almaty" });

  const system = `You are Sapar AI, a careful travel planner for Almaty city and the Almaty region of Kazakhstan.
RULES (strict):
1. For sightseeing use ONLY places from DATABASE, referenced by "placeId". For generic items (meals, city transfers, check-in, overnight) use placeId "none".
2. NEVER write prices, costs, amounts of money or currencies in any text field. All costs are calculated by our server from the databases.
3. In "priceIds" list only price ids of that place from DATABASE that the traveller will actually pay (e.g. entry, gondola). Empty array if none apply.
4. In "generalCosts" reference GENERAL COSTS by id with "qty" = how many times (rides, meals or nights) — never money:
   - city transport in Almaty: metro, bus or taxi-city (qty = number of rides; one ride per direction);
   - every lunch and dinner: one item with meal-canteen or meal-cafe (qty 1);
   - every night of the trip (usually days − 1 nights): one evening item with hostel or hotel-mid (qty 1), unless the traveller says they already have accommodation;
   - a place visit that is a tour already includes its transport: do not add taxi for it.
5. Choose cheaper options (metro/bus, canteen, hostel) when the budget per person is low; taxi and hotel when it is comfortable. A group of 3–4 often makes taxi cheaper per person.
6. Be realistic about distance and time: places over 150 km from Almaty usually need a full day or an overnight stay; group nearby places together.
7. Current month is ${month}. Respect each place's season and add a warning if a place is out of season.
8. If you are not sure about a fact, say it is unknown instead of guessing.
9. Write ALL text in ${input.language}.`;

  const prompt = `DATABASE (places):\n${JSON.stringify(placesForPrompt())}

GENERAL COSTS:\n${JSON.stringify(costsForPrompt())}

TRAVELLERS:
- Group size: ${input.travellers} ${input.travellers === 1 ? "person" : "people travelling together"}
- Days: ${input.days}
- Budget per person: ${input.budget} KZT
- Interests: ${input.interests.join(", ") || "any"}
- Starting city: ${input.startCity}
- Extra wishes: ${input.extra || "none"}

Return exactly ${input.days} days.`;

  const db = { places: PLACES, costs: COSTS };
  const opts = { days: input.days, travellers: input.travellers };
  const started = Date.now();

  try {
    // 1) AI builds the plan. AiPlan.parse runs inside the retry loop: a malformed answer triggers the next model.
    const ai = await geminiJson({
      system,
      prompt,
      schema: SCHEMA,
      parse: (d) => AiPlan.parse(d),
      limits: { budgetMs: FIRST_CALL_MS, attemptTimeoutMs: 20_000 },
    });

    // 2) Server validates it against the databases and calculates costs (database prices only).
    let result = validatePlan(ai.data, db, opts);
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
Re-plan the trip to fit the budget: choose cheaper options — hostel instead of hotel, metro/bus instead of taxi, canteen instead of café, free places instead of paid tours and tickets.
Keep the traveller's requirements: exactly ${input.days} days, the group size, the interests and the extra wishes. Follow all the RULES. Return the complete revised plan.`;
        const second = await geminiJson({
          system,
          prompt: `${prompt}\n\nYOUR PREVIOUS PLAN:\n${JSON.stringify(ai.data)}\n\n${feedback}`,
          schema: SCHEMA,
          parse: (d) => AiPlan.parse(d),
          preferModel: ai.model,
          limits: { budgetMs: remaining - 2_000, attemptTimeoutMs: Math.min(20_000, remaining - 2_000), maxAttempts: 2 },
        });
        const revised = validatePlan(second.data, db, opts);
        // Accept the new plan only if it is really cheaper.
        if (revised.totals.perPerson.min < original.min) {
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
    const advice = budgetCheck.fits ? null : budgetAdvice(result.plan.days, result.totals.perPerson, COSTS, result.travellers);

    recordPlan(result.validation, fallback);
    return Response.json({ ...result, budget: input.budget, model, fallback, budgetCheck, advice });
  } catch (e) {
    if (!(e instanceof MissingKeyError)) recordPlanError();
    return handleAiError(e);
  }
}

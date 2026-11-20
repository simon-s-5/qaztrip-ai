import { z } from "zod";
import { geminiJson, MissingKeyError } from "@/lib/gemini";
import { PLACES, PLACE_IDS, placesForPrompt } from "@/lib/places";
import { COSTS, COST_IDS, costsForPrompt } from "@/lib/costs";
import { MAX_QTY, MAX_TRAVELLERS, validatePlan } from "@/lib/planValidation";
import { recordPlan, recordPlanError } from "@/lib/metrics";
import { apiError, checkLimit, handleAiError, LANGUAGE_RE } from "@/lib/api";

export const maxDuration = 60;

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

  try {
    // AiPlan.parse runs inside the retry loop: a malformed answer triggers the next model.
    const ai = await geminiJson({ system, prompt, schema: SCHEMA, parse: (d) => AiPlan.parse(d) });

    // Server-side validation against the databases + cost calculation (database prices only).
    const result = validatePlan(ai.data, { places: PLACES, costs: COSTS }, { days: input.days, travellers: input.travellers });
    recordPlan(result.validation, ai.fallback);
    return Response.json({ ...result, budget: input.budget, model: ai.model, fallback: ai.fallback });
  } catch (e) {
    if (!(e instanceof MissingKeyError)) recordPlanError();
    return handleAiError(e);
  }
}

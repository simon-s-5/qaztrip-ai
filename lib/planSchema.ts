import { z } from "zod";
import { PLACE_IDS } from "./places";
import { COST_IDS } from "./costs";
import { DRIVER_IDS } from "./drivers";
import { LOCKABLE, LODGING, MEAL_MODES, MEAL_PLACES, MEALS, OVERRIDE_FIELDS, TRANSPORT } from "./conditions";
import { MAX_QTY } from "./planValidation";

const str = { type: "string" };
const mealMode = { type: "string", enum: [...MEAL_MODES] };

/** JSON schema of the planner answer (given to Gemini as responseJsonSchema). */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    conditions: {
      type: "object",
      description: "The traveller's situation: form conditions with the free text applied on top (text wins)",
      properties: {
        lodging: { type: "string", enum: [...LODGING] },
        transport: { type: "string", enum: [...TRANSPORT] },
        meals: {
          type: "object",
          properties: { breakfast: mealMode, lunch: mealMode, dinner: mealMode },
          required: [...MEALS],
        },
        overrides: {
          type: "array",
          description: "Exceptions for specific days only",
          items: {
            type: "object",
            properties: {
              day: { type: "integer" },
              field: { type: "string", enum: [...OVERRIDE_FIELDS] },
              value: { type: "string", enum: [...new Set([...LODGING, ...TRANSPORT, ...MEAL_MODES])] },
            },
            required: ["day", "field", "value"],
          },
        },
        notes: { type: "array", items: str, description: "Other wishes understood from the text, short" },
        mealPlace: { type: "string", enum: [...MEAL_PLACES] },
        locked: {
          type: "array",
          description: "Base fields the traveller explicitly asked for in the text",
          items: { type: "string", enum: [...LOCKABLE] },
        },
        wishPlaces: {
          type: "array",
          description: "Place ids the traveller explicitly asked to visit",
          items: { type: "string", enum: PLACE_IDS },
        },
      },
      required: ["lodging", "transport", "meals", "mealPlace", "overrides", "notes", "locked", "wishPlaces"],
    },
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
                meal: { type: "string", enum: [...MEALS, "none"] },
                isTransfer: { type: "boolean", description: "true if this item is mainly travelling from one place to another" },
                driverId: {
                  type: "string",
                  enum: [...DRIVER_IDS, "none"],
                  description: "Driver from DRIVERS for a trip to a nature place, or none",
                },
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
                  description: "City rides and bought meals from GENERAL COSTS, with a count",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", enum: COST_IDS },
                      qty: {
                        type: "integer",
                        minimum: 1,
                        maximum: MAX_QTY,
                        description: "Number of rides or meals (not money)",
                      },
                    },
                    required: ["id", "qty"],
                  },
                },
              },
              required: ["time", "placeId", "meal", "isTransfer", "driverId", "activity", "transport", "notes", "priceIds", "generalCosts"],
            },
          },
        },
        required: ["day", "title", "items"],
      },
    },
    tips: { type: "array", items: str },
    warnings: { type: "array", items: str },
  },
  required: ["conditions", "title", "overview", "days", "tips", "warnings"],
};

const text = (max: number) => z.string().max(max);

/** Validates the AI plan (also used for plans sent back by the browser for recalculation). */
export const AiPlanZ = z.object({
  title: text(300),
  overview: text(2000),
  days: z
    .array(
      z.object({
        day: z.number(),
        title: text(300),
        items: z
          .array(
            z.object({
              time: text(50),
              placeId: text(60),
              meal: z.enum([...MEALS, "none"]).catch("none"),
              isTransfer: z.boolean().catch(false),
              driverId: z.string().max(60).catch("none").default("none"),
              activity: text(1000),
              transport: text(1000),
              notes: text(1000),
              priceIds: z.array(text(60)).max(20),
              generalCosts: z
                .array(z.object({ id: text(60), qty: z.number() }))
                .max(20)
                .catch([]),
            }),
          )
          .max(20),
      }),
    )
    .max(15),
  tips: z.array(text(1000)).max(20),
  warnings: z.array(text(1000)).max(20),
});

/** The AI answer = plan + its interpretation of the traveller's conditions (sanitized separately). */
export const AiAnswerZ = AiPlanZ.extend({ conditions: z.unknown() });

export type AiPlanData = z.infer<typeof AiPlanZ>;

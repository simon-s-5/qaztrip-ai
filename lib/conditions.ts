/**
 * Traveller's situation ("conditions"): where they sleep, how they move, how they eat.
 * Base values come from the form; the AI turns free text into the same structure
 * (text wins on conflict), with per-day exceptions. Pure logic, unit-tested:
 * see tests/conditions.test.mts and tests/wishes.test.mts.
 *
 * "Explicit wishes" (`locked`, per-day exceptions, `wishPlaces`) are never replaced to save money:
 * the server only shows what they cost (lib/wishes.ts). Everything else may be made cheaper.
 */

export const LODGING = ["hotel", "hostel", "free", "apartment"] as const;
export const TRANSPORT = ["public", "taxi", "rental", "own"] as const;
export const MEAL_MODES = ["buy", "guest", "self"] as const;
export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export const MEAL_PLACES = ["auto", "cafe", "canteen"] as const;
export const FOOD_FORM = ["buy", "partly", "self"] as const;
export const OVERRIDE_FIELDS = ["lodging", "transport", ...MEALS] as const;
/** Base fields that can be an explicit wish (and otherwise be made cheaper by the server). */
export const LOCKABLE = ["lodging", "transport", "mealPlace"] as const;

export type Lodging = (typeof LODGING)[number];
export type Transport = (typeof TRANSPORT)[number];
export type MealMode = (typeof MEAL_MODES)[number];
export type Meal = (typeof MEALS)[number];
export type MealPlace = (typeof MEAL_PLACES)[number];
export type FoodForm = (typeof FOOD_FORM)[number];
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];
export type Lockable = (typeof LOCKABLE)[number];
export type Meals = Record<Meal, MealMode>;

/** A rule that applies to one day only, e.g. { day: 3, field: "transport", value: "rental" }. Always an explicit wish. */
export type Override = { day: number; field: OverrideField; value: string };

export type Conditions = {
  lodging: Lodging;
  transport: Transport;
  meals: Meals;
  /** Where bought meals are eaten: "auto" lets the planner choose. */
  mealPlace: MealPlace;
  overrides: Override[];
  /** Other wishes the AI understood from the free text (shown to the user). */
  notes: string[];
  /** Base fields the traveller explicitly asked for: never replaced to save money. */
  locked: Lockable[];
  /** Places the traveller explicitly asked to visit: never dropped to save money. */
  wishPlaces: string[];
};

/** Conditions resolved for one day. `lodging` is the night after this day (null on the last day). */
export type DayConditions = {
  day: number;
  lodging: Lodging | null;
  transport: Transport;
  meals: Meals;
  mealPlace: MealPlace;
};

export type FormConditions = { lodging: Lodging; transport: Transport; food: FoodForm };

export const DEFAULT_FORM: FormConditions = { lodging: "hotel", transport: "public", food: "buy" };

const FOOD_TO_MEALS: Record<FoodForm, Meals> = {
  buy: { breakfast: "buy", lunch: "buy", dinner: "buy" },
  // "Some meals as guests": dinner by default; the text or the user can refine it.
  partly: { breakfast: "buy", lunch: "buy", dinner: "guest" },
  self: { breakfast: "self", lunch: "self", dinner: "self" },
};

/** `explicit`: form fields the user actually changed (untouched defaults are not wishes). */
export function formToConditions(f: FormConditions, explicit: Lockable[] = []): Conditions {
  return {
    lodging: f.lodging,
    transport: f.transport,
    meals: { ...FOOD_TO_MEALS[f.food] },
    mealPlace: "auto",
    overrides: [],
    notes: [],
    locked: [...new Set(explicit)],
    wishPlaces: [],
  };
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export function validOverrideValue(field: OverrideField, value: unknown): boolean {
  if (field === "lodging") return isOneOf(LODGING, value);
  if (field === "transport") return isOneOf(TRANSPORT, value);
  return isOneOf(MEAL_MODES, value);
}

/**
 * Cleans conditions coming from the AI or from the browser: unknown values fall back
 * to `fallback`, invalid or out-of-range exceptions are dropped, the last exception wins.
 * `placeIds`: valid place ids for `wishPlaces` (unknown ids are dropped).
 */
export function sanitizeConditions(raw: unknown, days: number, fallback: Conditions, placeIds: readonly string[] = []): Conditions {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const meals = (r.meals && typeof r.meals === "object" ? r.meals : {}) as Record<string, unknown>;

  const byKey = new Map<string, Override>();
  for (const o of Array.isArray(r.overrides) ? r.overrides.slice(0, 50) : []) {
    const x = (o ?? {}) as Record<string, unknown>;
    const day = Number(x.day);
    if (!Number.isInteger(day) || day < 1 || day > days) continue;
    if (!isOneOf(OVERRIDE_FIELDS, x.field) || !validOverrideValue(x.field, x.value)) continue;
    if (x.field === "lodging" && day === days) continue; // no night after the last day
    byKey.set(`${day}:${x.field}`, { day, field: x.field, value: String(x.value) });
  }

  const notes = (Array.isArray(r.notes) ? r.notes : [])
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .map((n) => n.trim().slice(0, 200))
    .slice(0, 6);

  const locked = Array.isArray(r.locked) ? r.locked.filter((x): x is Lockable => isOneOf(LOCKABLE, x)) : fallback.locked;
  const wishPlaces = Array.isArray(r.wishPlaces)
    ? r.wishPlaces.filter((x): x is string => typeof x === "string" && placeIds.includes(x))
    : fallback.wishPlaces;

  return {
    lodging: isOneOf(LODGING, r.lodging) ? r.lodging : fallback.lodging,
    transport: isOneOf(TRANSPORT, r.transport) ? r.transport : fallback.transport,
    meals: {
      breakfast: isOneOf(MEAL_MODES, meals.breakfast) ? meals.breakfast : fallback.meals.breakfast,
      lunch: isOneOf(MEAL_MODES, meals.lunch) ? meals.lunch : fallback.meals.lunch,
      dinner: isOneOf(MEAL_MODES, meals.dinner) ? meals.dinner : fallback.meals.dinner,
    },
    mealPlace: isOneOf(MEAL_PLACES, r.mealPlace) ? r.mealPlace : fallback.mealPlace,
    overrides: [...byKey.values()].sort((a, b) => a.day - b.day || a.field.localeCompare(b.field)),
    notes,
    locked: [...new Set(locked)],
    wishPlaces: [...new Set(wishPlaces)].slice(0, 10),
  };
}

/**
 * Which conditions to use: without free text the form is the source of truth;
 * with free text, the AI's interpretation (form + text, text wins) is used.
 * Explicit wishes = fields the user changed in the form + wishes the AI found in the text.
 */
export function chooseConditions(
  form: Conditions,
  fromAi: unknown,
  hasText: boolean,
  days: number,
  placeIds: readonly string[] = [],
): Conditions {
  if (!hasText) return form;
  const c = sanitizeConditions(fromAi, days, { ...form, locked: [], wishPlaces: [] }, placeIds);
  return { ...c, locked: [...new Set([...form.locked, ...c.locked])] };
}

/** Per-day table: base values with that day's exceptions applied. Nights = days − 1. */
export function resolveConditions(c: Conditions, days: number): DayConditions[] {
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const d: DayConditions = {
      day,
      lodging: day < days ? c.lodging : null,
      transport: c.transport,
      meals: { ...c.meals },
      mealPlace: c.mealPlace ?? "auto",
    };
    for (const o of c.overrides) {
      if (o.day !== day) continue;
      if (o.field === "lodging" && day < days) d.lodging = o.value as Lodging;
      else if (o.field === "transport") d.transport = o.value as Transport;
      else if (isOneOf(MEALS, o.field)) d.meals[o.field] = o.value as MealMode;
    }
    return d;
  });
}

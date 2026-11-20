/**
 * Validates an AI-generated plan against our databases and calculates costs.
 * Pure function (no AI, no I/O) so it can be unit-tested: see tests/planValidation.test.mts
 * and tests/conditions.test.mts.
 *
 * The AI only references ids (place prices and general costs), counts (rides, meals) and meal slots.
 * All amounts are calculated here from data/places.json and data/costs.json.
 * When the traveller's conditions are given, the server (not the AI) decides lodging, car rental,
 * fuel and groceries, and turns meals/lodging at relatives or self-cooking into 0 ₸ lines.
 */
import type { Place } from "./places";
import type { GeneralCost } from "./costs";
import type { DayConditions, Meal } from "./conditions";

export type AiCostRef = { id: string; qty: number };
export type AiItem = {
  time: string;
  placeId: string;
  activity: string;
  transport: string;
  notes: string;
  priceIds: string[];
  generalCosts: AiCostRef[];
  /** Which meal this item is ("none" for other activities). */
  meal?: Meal | "none";
  /** True if the item is mainly travelling between places. */
  isTransfer?: boolean;
};
export type AiDay = { day: number; title: string; items: AiItem[] };
export type AiPlan = { title: string; overview: string; days: AiDay[]; tips: string[]; warnings: string[] };

export type Range = { min: number; max: number };

/** Why a line costs 0 ₸ (shown as an explanation). */
export type FreeReason = "lodging-free" | "meal-guest" | "meal-self" | "by-car";

export type Cost = {
  /** place = place price; general = costs.json; condition = 0 ₸ because of the traveller's situation. */
  source: "place" | "general" | "condition";
  /** Place price id, general cost id or FreeReason. */
  id: string;
  /** How many times (rides, meals, nights); 1 for place prices; km/100 for fuel. */
  qty: number;
  unit: "person" | "vehicle" | "room";
  /** People per vehicle/room (1 for "person"). */
  capacity: number;
  /** Vehicles/rooms needed for the group (= travellers for "person"). */
  units: number;
  perPerson: Range;
  group: Range;
  verified: boolean;
  /** Estimated driving distance for fuel lines. */
  km?: number;
};

/** Quality metrics of one AI answer. */
export type PlanValidation = {
  daysRequested: number;
  daysReturned: number;
  items: number;
  /** Items without any known cost (shown as "unknown"). */
  itemsUnknown: number;
  /** Items the AI linked to a place ("none" not counted). */
  placeRefs: number;
  /** Of those, how many ids really exist in the database. */
  placeRefsValid: number;
  /** Price ids the AI referenced (place prices + general costs). */
  priceRefs: number;
  /** Of those, how many exist in the database. */
  priceRefsValid: number;
  /** Money amounts the AI wrote in text despite the rules (removed by the server). */
  moneyRemoved: number;
  /** Database prices used that are not yet verified by a human. */
  unverifiedPrices: number;
};

export type Db = { places: Place[]; costs: GeneralCost[] };

const MONEY_RE =
  /(?:₸|\$|€|USD|KZT)\s?\d[\d\s.,]*|\d[\d\s.,]*\s?(?:₸|тг\.?|тенге|теңге|tenge|KZT|USD|\$|€|доллар\w*|dollars?)/giu;

export const MAX_QTY = 10;
export const MAX_TRAVELLERS = 20;

/** General costs the server controls itself when conditions are given (the AI's choice is ignored). */
const SERVER_CONTROLLED = new Set(["hostel", "hotel-mid", "apartment", "car-rental", "fuel-100km", "groceries"]);
const RIDES = new Set(["metro", "bus", "taxi-city"]);
const MEAL_COSTS = new Set(["meal-canteen", "meal-cafe"]);
const LODGING_COST = { hotel: "hotel-mid", hostel: "hostel", apartment: "apartment" } as const;

const add = (a: Range, b: Range): Range => ({ min: a.min + b.min, max: a.max + b.max });
const ZERO: Range = { min: 0, max: 0 };

/** Group and per-person amount for one price. Shared units (car, room) are split between travellers. */
export function amount(price: Range, unit: Cost["unit"], capacity: number, qty: number, travellers: number) {
  const units = unit === "person" ? travellers : Math.ceil(travellers / Math.max(1, capacity));
  const group = { min: Math.round(price.min * qty * units), max: Math.round(price.max * qty * units) };
  const perPerson = { min: Math.round(group.min / travellers), max: Math.round(group.max / travellers) };
  return { units, group, perPerson };
}

/**
 * Driving distance of a day by car: round trip to the farthest place of the day plus city driving.
 * Rounded to 10 km, at least 30 km.
 */
export function estimateKm(maxDistanceFromAlmaty: number): number {
  return Math.max(30, Math.round((2 * maxDistanceFromAlmaty + 30) / 10) * 10);
}

function clampQty(q: number): number {
  return Number.isFinite(q) ? Math.min(MAX_QTY, Math.max(1, Math.round(q))) : 1;
}

export function validatePlan(
  plan: AiPlan,
  db: Db,
  opts: { days: number; travellers: number; conditions?: DayConditions[] },
) {
  const travellers = Math.min(MAX_TRAVELLERS, Math.max(1, Math.round(opts.travellers)));
  const places = new Map(db.places.map((p) => [p.id, p]));
  const costs = new Map(db.costs.map((c) => [c.id, c]));
  const v: PlanValidation = {
    daysRequested: opts.days,
    daysReturned: plan.days.length,
    items: 0,
    itemsUnknown: 0,
    placeRefs: 0,
    placeRefsValid: 0,
    priceRefs: 0,
    priceRefsValid: 0,
    moneyRemoved: 0,
    unverifiedPrices: 0,
  };

  const strip = (s: string) =>
    s.replace(MONEY_RE, () => {
      v.moneyRemoved++;
      return "[?]";
    });

  const general = (c: GeneralCost, qty: number, extra?: Partial<Cost>): Cost => ({
    source: "general",
    id: c.id,
    qty,
    unit: c.unit,
    capacity: c.capacity,
    ...amount(c, c.unit, c.capacity, qty, travellers),
    verified: c.verified,
    ...extra,
  });
  const free = (id: FreeReason): Cost => ({
    source: "condition",
    id,
    qty: 1,
    unit: "person",
    capacity: 1,
    units: travellers,
    perPerson: ZERO,
    group: ZERO,
    verified: true,
  });

  let tripPerPerson = ZERO;
  let tripGroup = ZERO;
  let tripUnknown = 0;

  const days = plan.days.slice(0, opts.days).map((d, dayIndex) => {
    const dc = opts.conditions?.[dayIndex];
    let dayPerPerson = ZERO;
    let dayGroup = ZERO;
    let dayUnknown = 0;
    let farthest = 0;

    const items = d.items.slice(0, 12).map((it) => {
      v.items++;
      let place: Place | undefined;
      if (it.placeId && it.placeId !== "none") {
        v.placeRefs++;
        place = places.get(it.placeId);
        if (place) {
          v.placeRefsValid++;
          farthest = Math.max(farthest, place.distanceFromAlmatyKm);
        }
      }

      const itemCosts: Cost[] = [];

      // 1) Place prices (always per person).
      const priceIds = [...new Set(it.priceIds)];
      v.priceRefs += priceIds.length;
      for (const id of priceIds) {
        const p = place?.prices.find((x) => x.id === id);
        if (!p) continue; // invented id → dropped
        v.priceRefsValid++;
        itemCosts.push({
          source: "place",
          id,
          qty: 1,
          unit: "person",
          capacity: 1,
          ...amount(p, "person", 1, 1, travellers),
          verified: p.verified,
        });
      }

      // 2) General costs referenced by the AI. Duplicates: keep the first.
      const refs = new Map<string, AiCostRef>();
      for (const ref of it.generalCosts ?? []) if (!refs.has(ref.id)) refs.set(ref.id, ref);
      v.priceRefs += refs.size;
      const mealSlot = it.meal && it.meal !== "none" ? it.meal : null;
      const mealMode = dc && mealSlot ? dc.meals[mealSlot] : "buy";
      let hasMealCost = false;
      let rideByCar = false;

      for (const ref of refs.values()) {
        let c = costs.get(ref.id);
        if (!c) continue; // invented id → dropped
        v.priceRefsValid++;
        if (dc) {
          if (SERVER_CONTROLLED.has(c.id)) continue; // lodging, car, fuel, groceries: added by the server below
          if (RIDES.has(c.id)) {
            if (dc.transport === "rental" || dc.transport === "own") {
              rideByCar = true; // travelling by car: counted in the day costs
              continue;
            }
            if (dc.transport === "public" && c.id === "taxi-city") c = costs.get("bus") ?? c;
            if (dc.transport === "taxi" && c.id !== "taxi-city") c = costs.get("taxi-city") ?? c;
          }
          if (MEAL_COSTS.has(c.id) && mealMode !== "buy") continue; // replaced by a 0 ₸ line
        }
        if (MEAL_COSTS.has(c.id)) hasMealCost = true;
        itemCosts.push(general(c, clampQty(ref.qty)));
      }

      // 3) Meals according to the conditions.
      if (dc && mealSlot) {
        if (mealMode === "guest") itemCosts.push(free("meal-guest"));
        else if (mealMode === "self") itemCosts.push(free("meal-self"));
        else if (!hasMealCost) {
          const canteen = costs.get("meal-canteen");
          if (canteen) itemCosts.push(general(canteen, 1));
        }
      }

      // A ride replaced by the day's car is not "unknown": its cost is in the day's car costs.
      const carDay = dc?.transport === "rental" || dc?.transport === "own";
      if (itemCosts.length === 0 && (rideByCar || (carDay && it.isTransfer))) itemCosts.push(free("by-car"));

      v.unverifiedPrices += itemCosts.filter((c) => !c.verified).length;
      if (itemCosts.length === 0) {
        dayUnknown++;
        v.itemsUnknown++;
      }
      for (const c of itemCosts) {
        dayPerPerson = add(dayPerPerson, c.perPerson);
        dayGroup = add(dayGroup, c.group);
      }

      return {
        time: strip(it.time),
        placeId: place ? place.id : null,
        meal: mealSlot,
        activity: strip(it.activity),
        transport: strip(it.transport),
        notes: strip(it.notes),
        costs: itemCosts.length > 0 ? itemCosts : null,
      };
    });

    // 4) Day-level costs decided by the server from the conditions.
    const dayCosts: Cost[] = [];
    if (dc) {
      if (dc.lodging === "free") dayCosts.push(free("lodging-free"));
      else if (dc.lodging) {
        const c = costs.get(LODGING_COST[dc.lodging]);
        if (c) dayCosts.push(general(c, 1));
      }
      if (dc.transport === "rental" || dc.transport === "own") {
        const rental = costs.get("car-rental");
        if (dc.transport === "rental" && rental) dayCosts.push(general(rental, 1));
        const fuel = costs.get("fuel-100km");
        const km = estimateKm(farthest);
        if (fuel) dayCosts.push(general(fuel, km / 100, { km }));
      }
      if (Object.values(dc.meals).includes("self")) {
        const g = costs.get("groceries");
        if (g) dayCosts.push(general(g, 1));
      }
      v.unverifiedPrices += dayCosts.filter((c) => !c.verified).length;
      for (const c of dayCosts) {
        dayPerPerson = add(dayPerPerson, c.perPerson);
        dayGroup = add(dayGroup, c.group);
      }
    }

    tripPerPerson = add(tripPerPerson, dayPerPerson);
    tripGroup = add(tripGroup, dayGroup);
    tripUnknown += dayUnknown;
    return {
      day: d.day,
      title: strip(d.title),
      items,
      dayCosts,
      perPerson: dayPerPerson,
      group: dayGroup,
      unknownCount: dayUnknown,
    };
  });

  return {
    plan: {
      title: strip(plan.title),
      overview: strip(plan.overview),
      days,
      tips: plan.tips.map(strip),
      warnings: plan.warnings.map(strip),
    },
    totals: { perPerson: tripPerPerson, group: tripGroup, unknownCount: tripUnknown },
    travellers,
    validation: v,
  };
}

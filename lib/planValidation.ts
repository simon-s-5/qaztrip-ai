/**
 * Validates an AI-generated plan against our databases and calculates costs.
 * Pure function (no AI, no I/O) so it can be unit-tested: see tests/planValidation.test.mts.
 *
 * The AI only references ids (place prices and general costs) and counts (rides, meals, nights).
 * All amounts are calculated here from data/places.json and data/costs.json.
 */
import type { Place } from "./places";
import type { GeneralCost } from "./costs";

export type AiCostRef = { id: string; qty: number };
export type AiItem = {
  time: string;
  placeId: string;
  activity: string;
  transport: string;
  notes: string;
  priceIds: string[];
  generalCosts: AiCostRef[];
};
export type AiDay = { day: number; title: string; items: AiItem[] };
export type AiPlan = { title: string; overview: string; days: AiDay[]; tips: string[]; warnings: string[] };

export type Range = { min: number; max: number };

export type Cost = {
  source: "place" | "general";
  /** Place price id or general cost id. */
  id: string;
  /** How many times (rides, meals, nights); always 1 for place prices. */
  qty: number;
  unit: "person" | "vehicle" | "room";
  /** People per vehicle/room (1 for "person"). */
  capacity: number;
  /** Vehicles/rooms needed for the group (= travellers for "person"). */
  units: number;
  perPerson: Range;
  group: Range;
  verified: boolean;
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

const add = (a: Range, b: Range): Range => ({ min: a.min + b.min, max: a.max + b.max });
const ZERO: Range = { min: 0, max: 0 };

/** Group and per-person amount for one price. Shared units (car, room) are split between travellers. */
export function amount(price: Range, unit: Cost["unit"], capacity: number, qty: number, travellers: number) {
  const units = unit === "person" ? travellers : Math.ceil(travellers / Math.max(1, capacity));
  const group = { min: price.min * qty * units, max: price.max * qty * units };
  const perPerson = { min: Math.round(group.min / travellers), max: Math.round(group.max / travellers) };
  return { units, group, perPerson };
}

function clampQty(q: number): number {
  return Number.isFinite(q) ? Math.min(MAX_QTY, Math.max(1, Math.round(q))) : 1;
}

export function validatePlan(plan: AiPlan, db: Db, opts: { days: number; travellers: number }) {
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

  let tripPerPerson = ZERO;
  let tripGroup = ZERO;
  let tripUnknown = 0;

  const days = plan.days.slice(0, opts.days).map((d) => {
    let dayPerPerson = ZERO;
    let dayGroup = ZERO;
    let dayUnknown = 0;

    const items = d.items.slice(0, 12).map((it) => {
      v.items++;
      let place: Place | undefined;
      if (it.placeId && it.placeId !== "none") {
        v.placeRefs++;
        place = places.get(it.placeId);
        if (place) v.placeRefsValid++;
      }

      const itemCosts: Cost[] = [];

      // 1) Place prices (always per person).
      const priceIds = [...new Set(it.priceIds)];
      v.priceRefs += priceIds.length;
      for (const id of priceIds) {
        const p = place?.prices.find((x) => x.id === id);
        if (!p) continue; // invented id → dropped
        v.priceRefsValid++;
        itemCosts.push({ source: "place", id, qty: 1, unit: "person", capacity: 1, ...amount(p, "person", 1, 1, travellers), verified: p.verified });
      }

      // 2) General costs (transport, meals, accommodation) with a count.
      // Duplicated ids: keep the first one (a duplicate is not counted as a mismatch).
      const refs = new Map<string, AiCostRef>();
      for (const ref of it.generalCosts ?? []) if (!refs.has(ref.id)) refs.set(ref.id, ref);
      v.priceRefs += refs.size;
      for (const ref of refs.values()) {
        const c = costs.get(ref.id);
        if (!c) continue; // invented id → dropped
        v.priceRefsValid++;
        const qty = clampQty(ref.qty);
        itemCosts.push({ source: "general", id: c.id, qty, unit: c.unit, capacity: c.capacity, ...amount(c, c.unit, c.capacity, qty, travellers), verified: c.verified });
      }

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
        activity: strip(it.activity),
        transport: strip(it.transport),
        notes: strip(it.notes),
        costs: itemCosts.length > 0 ? itemCosts : null,
      };
    });

    tripPerPerson = add(tripPerPerson, dayPerPerson);
    tripGroup = add(tripGroup, dayGroup);
    tripUnknown += dayUnknown;
    return { day: d.day, title: strip(d.title), items, perPerson: dayPerPerson, group: dayGroup, unknownCount: dayUnknown };
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

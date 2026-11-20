// Deterministic tests of the plan validator and cost calculation (no AI calls). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amount, validatePlan, type AiItem, type AiPlan } from "../lib/planValidation.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const db = { places: read("../data/places.json"), costs: read("../data/costs.json") };
const charynEntry = db.places.find((p: { id: string }) => p.id === "charyn").prices.find((p: { id: string }) => p.id === "entry");
const cost = (id: string) => db.costs.find((c: { id: string }) => c.id === id);

function item(over: Partial<AiItem>): AiItem {
  return { time: "09:00", placeId: "none", activity: "x", transport: "", notes: "", priceIds: [], generalCosts: [], ...over };
}
function plan(items: AiItem[], days = 1): AiPlan {
  return {
    title: "t",
    overview: "o",
    days: Array.from({ length: days }, (_, i) => ({ day: i + 1, title: `Day ${i + 1}`, items })),
    tips: [],
    warnings: [],
  };
}
const run = (p: AiPlan, travellers = 1, days = 1) => validatePlan(p, db, { days, travellers });

test("place costs come only from the database", () => {
  const r = run(plan([item({ placeId: "charyn", priceIds: ["entry"] })]));
  assert.deepEqual(r.totals.perPerson, { min: charynEntry.min, max: charynEntry.max });
  assert.equal(r.totals.unknownCount, 0);
  assert.equal(r.validation.placeRefsValid, 1);
  assert.equal(r.validation.priceRefsValid, 1);
});

test("a place id that is not in the database becomes unknown", () => {
  const r = run(plan([item({ placeId: "fake-lake", priceIds: ["entry"] })]));
  assert.equal(r.plan.days[0].items[0].placeId, null);
  assert.equal(r.plan.days[0].items[0].costs, null);
  assert.equal(r.totals.unknownCount, 1);
  assert.equal(r.validation.itemsUnknown, 1);
  assert.equal(r.validation.placeRefsValid, 0);
});

test("invented price ids and cost ids are dropped and counted", () => {
  const r = run(
    plan([item({ placeId: "charyn", priceIds: ["entry", "vip-helicopter"], generalCosts: [{ id: "limousine", qty: 1 }] })]),
  );
  assert.equal(r.validation.priceRefs, 3);
  assert.equal(r.validation.priceRefsValid, 1);
  assert.equal(r.plan.days[0].items[0].costs?.length, 1);
});

test("a place without prices and without general costs is unknown", () => {
  const r = run(plan([item({ placeId: "butakovka" })]));
  assert.equal(r.plan.days[0].items[0].costs, null);
  assert.equal(r.totals.unknownCount, 1);
});

test("a general cost makes a generic item known (meal, qty = number of meals)", () => {
  const meal = cost("meal-canteen");
  const r = run(plan([item({ generalCosts: [{ id: "meal-canteen", qty: 2 }] })]));
  assert.equal(r.totals.unknownCount, 0);
  assert.deepEqual(r.totals.perPerson, { min: meal.min * 2, max: meal.max * 2 });
});

test("per-person prices are multiplied by the group size", () => {
  const meal = cost("meal-cafe");
  const r = run(plan([item({ generalCosts: [{ id: "meal-cafe", qty: 1 }] })]), 3);
  assert.deepEqual(r.totals.perPerson, { min: meal.min, max: meal.max });
  assert.deepEqual(r.totals.group, { min: meal.min * 3, max: meal.max * 3 });
});

test("a taxi is shared: 5 people need 2 cars, split per person", () => {
  const taxi = cost("taxi-city");
  assert.equal(taxi.capacity, 4);
  const r = run(plan([item({ generalCosts: [{ id: "taxi-city", qty: 1 }] })]), 5);
  const c = r.plan.days[0].items[0].costs![0];
  assert.equal(c.units, 2);
  assert.deepEqual(c.group, { min: taxi.min * 2, max: taxi.max * 2 });
  assert.deepEqual(c.perPerson, { min: Math.round((taxi.min * 2) / 5), max: Math.round((taxi.max * 2) / 5) });
});

test("a hotel room is shared by 2: 3 people need 2 rooms", () => {
  const hotel = cost("hotel-mid");
  const r = amount(hotel, "room", hotel.capacity, 1, 3);
  assert.equal(r.units, 2);
  assert.deepEqual(r.group, { min: hotel.min * 2, max: hotel.max * 2 });
});

test("a solo traveller pays the whole taxi", () => {
  const taxi = cost("taxi-city");
  const r = run(plan([item({ generalCosts: [{ id: "taxi-city", qty: 2 }] })]), 1);
  assert.deepEqual(r.totals.perPerson, { min: taxi.min * 2, max: taxi.max * 2 });
});

test("quantities are clamped to 1..10 and duplicates ignored", () => {
  const bus = cost("bus");
  const r = run(
    plan([
      item({
        generalCosts: [
          { id: "bus", qty: 999 },
          { id: "bus", qty: 3 },
        ],
      }),
    ]),
  );
  const costs = r.plan.days[0].items[0].costs!;
  assert.equal(costs.length, 1);
  assert.equal(r.validation.priceRefs, 1);
  assert.equal(r.validation.priceRefsValid, 1);
  assert.equal(costs[0].qty, 10);
  assert.deepEqual(r.totals.perPerson, { min: bus.min * 10, max: bus.max * 10 });
});

test("money written by the AI is removed, other numbers are kept", () => {
  const r = run(plan([item({ activity: "Entry costs 1 500 ₸, about $3", notes: "Walk 3 km, 2 hours" })]));
  const it = r.plan.days[0].items[0];
  assert.ok(!/₸|\$\s?\d/.test(it.activity), it.activity);
  assert.equal(it.notes, "Walk 3 km, 2 hours");
  assert.equal(r.validation.moneyRemoved, 2);
});

test("extra days are trimmed to the requested number", () => {
  const r = validatePlan(plan([item({})], 5), db, { days: 3, travellers: 1 });
  assert.equal(r.plan.days.length, 3);
  assert.equal(r.validation.daysReturned, 5);
  assert.equal(r.validation.daysRequested, 3);
});

test("every general cost in the database is marked unverified until checked", () => {
  for (const c of db.costs) {
    assert.equal(c.verified, false, c.id);
    assert.ok(c.min <= c.max, c.id);
    assert.ok(["person", "vehicle", "room"].includes(c.unit), c.id);
  }
});

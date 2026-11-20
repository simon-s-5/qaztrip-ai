// Tests of the budget advice (minimum budget + ways to save). No AI calls. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { budgetAdvice, isOverBudget } from "../lib/budgetAdvice.ts";
import { validatePlan, type AiItem, type AiPlan } from "../lib/planValidation.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const db = { places: read("../data/places.json"), costs: read("../data/costs.json") };
const cost = (id: string) => db.costs.find((c: { id: string }) => c.id === id);

function item(over: Partial<AiItem>): AiItem {
  return { time: "09:00", placeId: "none", activity: "x", transport: "", notes: "", priceIds: [], generalCosts: [], ...over };
}
function plan(days: AiItem[][]): AiPlan {
  return { title: "t", overview: "o", days: days.map((items, i) => ({ day: i + 1, title: "d", items })), tips: [], warnings: [] };
}
function advise(p: AiPlan, travellers = 1) {
  const r = validatePlan(p, db, { days: p.days.length, travellers });
  return { r, a: budgetAdvice(r.plan.days, r.totals.perPerson, db.costs, travellers) };
}

test("over budget only when even the lower bound of known costs is above the budget", () => {
  assert.equal(isOverBudget({ min: 50_000, max: 90_000 }, 60_000), false);
  assert.equal(isOverBudget({ min: 61_000, max: 90_000 }, 60_000), true);
});

test("minimum budget is the known lower bound rounded up to 1000", () => {
  const { r, a } = advise(plan([[item({ generalCosts: [{ id: "meal-cafe", qty: 1 }, { id: "bus", qty: 1 }] })]]));
  const expected = Math.ceil(r.totals.perPerson.min / 1000) * 1000;
  assert.equal(a.minBudget, expected);
});

test("hotel → hostel saving is calculated from the databases", () => {
  const hotel = cost("hotel-mid");
  const hostel = cost("hostel");
  const { a } = advise(plan([[item({ generalCosts: [{ id: "hotel-mid", qty: 1 }] })]]), 1);
  const s = a.suggestions.find((x) => x.kind === "hostel");
  assert.ok(s);
  // Solo traveller pays the whole room.
  assert.equal(s.saving, Math.ceil((hotel.min - hostel.min) / 100) * 100);
});

test("taxi → bus saving accounts for a shared car", () => {
  const taxi = cost("taxi-city");
  const bus = cost("bus");
  const { a } = advise(plan([[item({ generalCosts: [{ id: "taxi-city", qty: 2 }] })]]), 4);
  const s = a.suggestions.find((x) => x.kind === "publicTransport");
  assert.ok(s);
  const perPersonTaxi = Math.round((taxi.min * 2) / 4);
  assert.equal(s.saving, Math.ceil((perPersonTaxi - bus.min * 2) / 100) * 100);
});

test("suggests dropping the most expensive day and the most expensive paid place", () => {
  const { a } = advise(
    plan([
      [item({ generalCosts: [{ id: "meal-canteen", qty: 1 }] })],
      [item({ placeId: "shymbulak", priceIds: ["gondola"] })],
    ]),
  );
  const days = a.suggestions.find((x) => x.kind === "fewerDays");
  const paid = a.suggestions.find((x) => x.kind === "skipPaid");
  assert.ok(days && days.kind === "fewerDays");
  assert.equal(days.day, 2);
  assert.ok(paid && paid.kind === "skipPaid");
  assert.equal(paid.placeId, "shymbulak");
});

test("at most 3 suggestions, biggest saving first, no zero savings", () => {
  const { a } = advise(
    plan([
      [
        item({ generalCosts: [{ id: "hotel-mid", qty: 1 }, { id: "taxi-city", qty: 2 }, { id: "meal-cafe", qty: 2 }] }),
        item({ placeId: "kolsai", priceIds: ["tour"] }),
      ],
      [item({ generalCosts: [{ id: "meal-canteen", qty: 1 }] })],
    ]),
  );
  assert.ok(a.suggestions.length <= 3);
  for (let i = 1; i < a.suggestions.length; i++) assert.ok(a.suggestions[i - 1].saving >= a.suggestions[i].saving);
  assert.ok(a.suggestions.every((s) => s.saving > 0));
});

test("a cheap plan (canteen, bus, hostel) gives no swap suggestions", () => {
  const { a } = advise(plan([[item({ generalCosts: [{ id: "hostel", qty: 1 }, { id: "bus", qty: 2 }, { id: "meal-canteen", qty: 1 }] })]]));
  assert.deepEqual(
    a.suggestions.filter((s) => ["hostel", "publicTransport", "canteen"].includes(s.kind)),
    [],
  );
});

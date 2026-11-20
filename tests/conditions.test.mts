// Tests of the traveller's conditions and the costs the server derives from them. No AI calls. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chooseConditions,
  formToConditions,
  resolveConditions,
  sanitizeConditions,
  type Conditions,
} from "../lib/conditions.ts";
import { estimateKm, validatePlan, type AiItem, type AiPlan } from "../lib/planValidation.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const db = { places: read("../data/places.json"), costs: read("../data/costs.json") };
const cost = (id: string) => db.costs.find((c: { id: string }) => c.id === id);

const form = formToConditions({ lodging: "hotel", transport: "public", food: "buy" });

function item(over: Partial<AiItem>): AiItem {
  return { time: "09:00", placeId: "none", activity: "x", transport: "", notes: "", priceIds: [], generalCosts: [], meal: "none", ...over };
}
function plan(days: AiItem[][]): AiPlan {
  return { title: "t", overview: "o", days: days.map((items, i) => ({ day: i + 1, title: "d", items })), tips: [], warnings: [] };
}
function run(p: AiPlan, c: Conditions, travellers = 1) {
  return validatePlan(p, db, { days: p.days.length, travellers, conditions: resolveConditions(c, p.days.length) });
}

// ---------- conditions ----------

test("form options map to conditions ('some meals as guests' = dinner as guests)", () => {
  const c = formToConditions({ lodging: "free", transport: "own", food: "partly" });
  assert.equal(c.lodging, "free");
  assert.equal(c.transport, "own");
  assert.deepEqual(c.meals, { breakfast: "buy", lunch: "buy", dinner: "guest" });
});

test("without free text the form wins, even if the AI returned something else", () => {
  const ai = { lodging: "hostel", transport: "taxi", meals: { breakfast: "self", lunch: "self", dinner: "self" }, overrides: [], notes: [] };
  assert.deepEqual(chooseConditions(form, ai, false, 3), form);
});

test("with free text the AI interpretation wins over the form", () => {
  const ai = { lodging: "hotel", transport: "public", meals: { breakfast: "buy", lunch: "buy", dinner: "guest" }, overrides: [{ day: 3, field: "transport", value: "rental" }], notes: ["dinner at relatives"] };
  const c = chooseConditions(form, ai, true, 3);
  assert.equal(c.meals.dinner, "guest");
  assert.deepEqual(c.overrides, [{ day: 3, field: "transport", value: "rental" }]);
  assert.deepEqual(c.notes, ["dinner at relatives"]);
});

test("invalid values from the AI fall back to the form; bad exceptions are dropped", () => {
  const c = sanitizeConditions(
    {
      lodging: "castle",
      transport: "taxi",
      meals: { breakfast: "buy", lunch: "pizza", dinner: "guest" },
      overrides: [
        { day: 9, field: "transport", value: "rental" }, // day out of range
        { day: 2, field: "transport", value: "helicopter" }, // invalid value
        { day: 3, field: "lodging", value: "hostel" }, // no night after the last day
        { day: 1, field: "dinner", value: "self" },
        { day: 1, field: "dinner", value: "guest" }, // last one wins
      ],
      notes: ["", "  keep it short  "],
    },
    3,
    form,
  );
  assert.equal(c.lodging, "hotel");
  assert.equal(c.transport, "taxi");
  assert.equal(c.meals.lunch, "buy");
  assert.deepEqual(c.overrides, [{ day: 1, field: "dinner", value: "guest" }]);
  assert.deepEqual(c.notes, ["keep it short"]);
});

test("resolve: exceptions apply only to their day; the last day has no night", () => {
  const c: Conditions = { ...form, overrides: [{ day: 3, field: "transport", value: "rental" }, { day: 1, field: "lodging", value: "free" }] };
  const d = resolveConditions(c, 3);
  assert.deepEqual(d.map((x) => x.transport), ["public", "public", "rental"]);
  assert.deepEqual(d.map((x) => x.lodging), ["free", "hotel", null]);
});

// ---------- costs from conditions ----------

test("lodging: hostel per person for every night (days − 1), never on the last day", () => {
  const hostel = cost("hostel");
  const r = run(plan([[item({})], [item({})], [item({})]]), { ...form, lodging: "hostel" });
  const nights = r.plan.days.map((d) => d.dayCosts.filter((c) => c.id === "hostel").length);
  assert.deepEqual(nights, [1, 1, 0]);
  assert.equal(r.totals.perPerson.min, hostel.min * 2);
});

test("lodging at relatives costs 0 ₸ with an explanation", () => {
  const r = run(plan([[item({})], [item({})]]), { ...form, lodging: "free" });
  const c = r.plan.days[0].dayCosts[0];
  assert.equal(c.source, "condition");
  assert.equal(c.id, "lodging-free");
  assert.deepEqual(c.perPerson, { min: 0, max: 0 });
  assert.equal(r.totals.perPerson.min, 0);
});

test("apartment is one flat for up to 4 people", () => {
  const apt = cost("apartment");
  const r = run(plan([[item({})], [item({})]]), { ...form, lodging: "apartment" }, 4);
  const c = r.plan.days[0].dayCosts[0];
  assert.equal(c.units, 1);
  assert.deepEqual(c.group, { min: apt.min, max: apt.max });
});

test("lodging chosen by the AI is ignored when conditions are given (no double counting)", () => {
  const r = run(plan([[item({ generalCosts: [{ id: "hotel-mid", qty: 1 }] })], [item({})]]), { ...form, lodging: "free" });
  assert.equal(r.totals.perPerson.min, 0);
});

test("dinner as guests: 0 ₸ line instead of the café", () => {
  const r = run(plan([[item({ meal: "dinner", generalCosts: [{ id: "meal-cafe", qty: 1 }] })]]), {
    ...form,
    meals: { breakfast: "buy", lunch: "buy", dinner: "guest" },
  });
  const costs = r.plan.days[0].items[0].costs!;
  assert.deepEqual(costs.map((c) => c.id), ["meal-guest"]);
  assert.equal(r.totals.perPerson.min, 0);
  assert.equal(r.totals.unknownCount, 0);
});

test("a bought meal without a cost from the AI gets the canteen price", () => {
  const canteen = cost("meal-canteen");
  const r = run(plan([[item({ meal: "lunch" })]]), form);
  assert.equal(r.totals.perPerson.min, canteen.min);
});

test("self-cooking: meals 0 ₸ and groceries once per day", () => {
  const g = cost("groceries");
  const self = formToConditions({ lodging: "free", transport: "public", food: "self" });
  const r = run(plan([[item({ meal: "breakfast" }), item({ meal: "dinner" })]]), self, 2);
  assert.deepEqual(r.plan.days[0].items.map((i) => i.costs![0].id), ["meal-self", "meal-self"]);
  assert.deepEqual(r.plan.days[0].dayCosts.map((c) => c.id), ["groceries"]);
  assert.deepEqual(r.totals.group, { min: g.min * 2, max: g.max * 2 });
});

test("'rent a car on day 3': rental + fuel on day 3 only, city rides dropped that day", () => {
  const c: Conditions = { ...form, lodging: "free", overrides: [{ day: 3, field: "transport", value: "rental" }] };
  const rides = [{ id: "bus", qty: 2 }];
  const r = run(plan([[item({ generalCosts: rides })], [item({ generalCosts: rides })], [item({ placeId: "charyn", generalCosts: rides })]]), c);
  assert.deepEqual(r.plan.days.map((d) => d.dayCosts.filter((x) => x.id === "car-rental").length), [0, 0, 1]);
  const fuel = r.plan.days[2].dayCosts.find((x) => x.id === "fuel-100km")!;
  assert.equal(fuel.km, estimateKm(200)); // Charyn is 200 km from Almaty
  // Bus rides dropped (travelling by car): shown as "by car — in the day costs", not "unknown".
  assert.deepEqual(r.plan.days[2].items[0].costs!.map((x) => x.id), ["by-car"]);
  assert.equal(r.totals.unknownCount, 0);
  assert.equal(r.plan.days[0].items[0].costs![0].id, "bus");
});

test("own car: only fuel, no rental", () => {
  const r = run(plan([[item({})]]), { ...form, transport: "own" });
  assert.deepEqual(r.plan.days[0].dayCosts.map((c) => c.id), ["fuel-100km"]);
  assert.equal(r.plan.days[0].dayCosts[0].km, 30);
});

test("public transport turns AI taxis into buses; taxi turns buses into taxis", () => {
  const pub = run(plan([[item({ generalCosts: [{ id: "taxi-city", qty: 2 }] })]]), form);
  assert.equal(pub.plan.days[0].items[0].costs![0].id, "bus");
  const taxi = run(plan([[item({ generalCosts: [{ id: "metro", qty: 2 }] })]]), { ...form, transport: "taxi" });
  assert.equal(taxi.plan.days[0].items[0].costs![0].id, "taxi-city");
});

test("fuel distance: round trip to the farthest place + city driving, at least 30 km", () => {
  assert.equal(estimateKm(0), 30);
  assert.equal(estimateKm(200), 430);
});

test("all new general costs are in the database and unverified", () => {
  for (const id of ["car-rental", "fuel-100km", "apartment", "groceries"]) {
    const c = cost(id);
    assert.ok(c, id);
    assert.equal(c.verified, false, id);
  }
});

test("a transfer on a car day is 'by car', not unknown; on other days it stays unknown", () => {
  const c: Conditions = { ...form, lodging: "free", overrides: [{ day: 2, field: "transport", value: "rental" }] };
  const r = run(plan([[item({ isTransfer: true })], [item({ isTransfer: true })]]), c);
  assert.equal(r.plan.days[0].items[0].costs, null);
  assert.deepEqual(r.plan.days[1].items[0].costs!.map((x) => x.id), ["by-car"]);
  assert.equal(r.totals.unknownCount, 1);
});

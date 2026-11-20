// Explicit wishes vs the budget: wishes are never replaced, their cost is shown; other things get cheaper.
// No AI calls. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chooseConditions, formToConditions, resolveConditions, sanitizeConditions, type Conditions } from "../lib/conditions.ts";
import { validatePlan, type AiItem, type AiPlan } from "../lib/planValidation.ts";
import { cheapenUnlocked, keepsWishPlaces, wishCosts } from "../lib/wishes.ts";
import { budgetAdvice } from "../lib/budgetAdvice.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const db = { places: read("../data/places.json"), costs: read("../data/costs.json") };
const placeIds = db.places.map((p: { id: string }) => p.id);
const cost = (id: string) => db.costs.find((c: { id: string }) => c.id === id);

function item(over: Partial<AiItem>): AiItem {
  return { time: "09:00", placeId: "none", activity: "x", transport: "", notes: "", priceIds: [], generalCosts: [], meal: "none", ...over };
}
function plan(days: AiItem[][]): AiPlan {
  return { title: "t", overview: "o", days: days.map((items, i) => ({ day: i + 1, title: "d", items })), tips: [], warnings: [] };
}
// A 3-day route with taxi rides and café meals.
const route = plan([
  [item({ meal: "lunch", generalCosts: [{ id: "meal-cafe", qty: 1 }] }), item({ generalCosts: [{ id: "taxi-city", qty: 2 }] })],
  [item({ placeId: "kolsai", priceIds: ["tour"] }), item({ meal: "dinner", generalCosts: [{ id: "meal-cafe", qty: 1 }] })],
  [item({ generalCosts: [{ id: "taxi-city", qty: 2 }] })],
]);
const calc = { days: 3, travellers: 1 };
const total = (p: AiPlan, c: Conditions) =>
  validatePlan(p, db, { ...calc, conditions: resolveConditions(c, p.days.length) }).totals.perPerson.min;
const evaluate = (c: Conditions) => total(route, c);

const base = (over: Partial<Conditions> = {}): Conditions => ({
  ...formToConditions({ lodging: "hotel", transport: "taxi", food: "buy" }),
  ...over,
});

test("not specified → the server picks the cheapest option (hotel → hostel, taxi → public, café → canteen)", () => {
  const { conditions, changes } = cheapenUnlocked(base(), evaluate);
  assert.equal(conditions.lodging, "hostel");
  assert.equal(conditions.transport, "public");
  assert.equal(conditions.mealPlace, "canteen");
  assert.deepEqual(changes.map((c) => c.field), ["lodging", "transport", "mealPlace"]);
  assert.ok(changes.every((c) => c.saving > 0));
  assert.ok(evaluate(conditions) < evaluate(base()));
});

test("explicit wishes are never replaced by the cheapening step", () => {
  const wished = base({ locked: ["lodging", "transport"] });
  const { conditions } = cheapenUnlocked(wished, evaluate);
  assert.equal(conditions.lodging, "hotel");
  assert.equal(conditions.transport, "taxi");
  assert.equal(conditions.mealPlace, "canteen"); // not a wish → cheaper
});

test("relatives' home and own car are facts, not choices: kept", () => {
  const { conditions } = cheapenUnlocked(base({ lodging: "free", transport: "own" }), evaluate);
  assert.equal(conditions.lodging, "free");
  assert.equal(conditions.transport, "own");
});

test("over budget: each wish shows its extra cost and the cheaper alternative (amounts from the server)", () => {
  const wished = base({ locked: ["lodging"], transport: "public", mealPlace: "canteen" });
  const current = evaluate(wished);
  const budget = current - 5_000;
  const w = wishCosts(wished, evaluate, budget);
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, "lodging");
  assert.equal(w[0].wish, "hotel");
  assert.equal(w[0].alternative, "hostel");
  const expected = current - evaluate({ ...wished, lodging: "hostel" });
  assert.equal(w[0].saving, Math.ceil(expected / 100) * 100);
  assert.equal(w[0].over, 5_000);
  assert.equal(w[0].fitsAfter, expected >= 5_000);
});

test("within budget: no wish messages", () => {
  const wished = base({ locked: ["lodging"] });
  assert.deepEqual(wishCosts(wished, evaluate, evaluate(wished) + 1), []);
});

test("a day exception ('rent a car on day 3') is a wish: alternative for that day only", () => {
  const wished = base({ lodging: "free", transport: "public", overrides: [{ day: 3, field: "transport", value: "rental" }] });
  const w = wishCosts(wished, evaluate, 0);
  const day = w.find((x) => x.kind === "override");
  assert.ok(day);
  assert.equal(day.day, 3);
  assert.equal(day.wish, "rental");
  assert.equal(day.alternative, "public");
});

test("a wished place shows its cost instead of being dropped", () => {
  const wished = base({ lodging: "free", transport: "public", wishPlaces: ["kolsai"] });
  const w = wishCosts(wished, evaluate, 0, { kolsai: 25_000 });
  const p = w.find((x) => x.kind === "place");
  assert.ok(p);
  assert.equal(p.wish, "kolsai");
  assert.equal(p.saving, 25_000);
});

test("budget advice does not suggest replacing wishes (shown separately)", () => {
  const r = validatePlan(route, db, { ...calc, conditions: resolveConditions(base({ transport: "public" }), 3) });
  const free = budgetAdvice(r.plan.days, r.totals.perPerson, db.costs, 1);
  const wished = budgetAdvice(r.plan.days, r.totals.perPerson, db.costs, 1, 3, { locked: ["lodging"], wishPlaces: ["kolsai"] });
  assert.ok(free.suggestions.some((s) => s.kind === "hostel"));
  assert.ok(!wished.suggestions.some((s) => s.kind === "hostel"));
  assert.ok(!wished.suggestions.some((s) => s.kind === "skipPaid" && s.placeId === "kolsai"));
});

test("re-plan guard: dropping a wished place rejects the revision", () => {
  const revised = plan([[item({})], [item({ placeId: "big-almaty-lake" })], [item({})]]);
  assert.equal(keepsWishPlaces(route, revised, ["kolsai"]), false);
  assert.equal(keepsWishPlaces(route, route, ["kolsai"]), true);
  assert.equal(keepsWishPlaces(route, revised, []), true);
  // A wished place the first route did not include cannot be "dropped".
  assert.equal(keepsWishPlaces(route, revised, ["charyn"]), true);
});

test("meal place wish: 'only cafés' prices bought meals at café level", () => {
  const cafe = cost("meal-cafe");
  const p = plan([[item({ meal: "lunch", generalCosts: [{ id: "meal-canteen", qty: 1 }] })]]);
  const c = base({ lodging: "free", transport: "public", mealPlace: "cafe", locked: ["mealPlace"] });
  assert.equal(validatePlan(p, db, { days: 1, travellers: 1, conditions: resolveConditions(c, 1) }).totals.perPerson.min, cafe.min);
});

test("form: only fields the user changed are wishes; text wishes are added", () => {
  const form = formToConditions({ lodging: "hotel", transport: "public", food: "buy" }, ["transport"]);
  assert.deepEqual(form.locked, ["transport"]);
  assert.deepEqual(chooseConditions(form, {}, false, 3).locked, ["transport"]);
  const ai = { lodging: "hotel", transport: "public", meals: form.meals, overrides: [], notes: [], locked: ["lodging"], wishPlaces: ["kolsai", "atlantis"] };
  const c = chooseConditions(form, ai, true, 3, placeIds);
  assert.deepEqual(c.locked.sort(), ["lodging", "transport"]);
  assert.deepEqual(c.wishPlaces, ["kolsai"]); // unknown place dropped
});

test("sanitize keeps only valid wish fields", () => {
  const c = sanitizeConditions({ locked: ["lodging", "budget", "mealPlace"], mealPlace: "fancy" }, 2, base(), placeIds);
  assert.deepEqual(c.locked, ["lodging", "mealPlace"]);
  assert.equal(c.mealPlace, "auto");
});

test("a meal item is one meal per traveller even if the AI multiplied qty by the group size", () => {
  const canteen = cost("meal-canteen");
  const p = plan([[item({ meal: "lunch", generalCosts: [{ id: "meal-canteen", qty: 2 }] })]]);
  const c = base({ lodging: "free", transport: "public", mealPlace: "canteen" });
  const r = validatePlan(p, db, { days: 1, travellers: 2, conditions: resolveConditions(c, 1) });
  assert.deepEqual(r.totals.perPerson, { min: canteen.min, max: canteen.max });
  assert.deepEqual(r.totals.group, { min: canteen.min * 2, max: canteen.max * 2 });
});

// Drivers database, road status and the "Request a driver" message. No AI calls. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePlan, type AiItem, type AiPlan } from "../lib/planValidation.ts";
import { formToConditions, resolveConditions } from "../lib/conditions.ts";
import { requestMessage, whatsappLink, whatsappNumber } from "../lib/request.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const places = read("../data/places.json");
const costs = read("../data/costs.json");
const drivers = read("../data/drivers.json");
const db = { places, costs, drivers };
const driver = (id: string) => drivers.find((d: { id: string }) => d.id === id);
const place = (id: string) => places.find((p: { id: string }) => p.id === id);

function item(over: Partial<AiItem>): AiItem {
  return { time: "09:00", placeId: "none", activity: "x", transport: "", notes: "", priceIds: [], generalCosts: [], meal: "none", driverId: "none", ...over };
}
function plan(days: AiItem[][]): AiPlan {
  return { title: "t", overview: "o", days: days.map((items, i) => ({ day: i + 1, title: "d", items })), tips: [], warnings: [] };
}
const conditions = (transport: "public" | "taxi" | "rental" | "own", days = 1) =>
  resolveConditions({ ...formToConditions({ lodging: "free", transport, food: "buy" }) }, days);

// ---------- drivers.json: privacy and demo rules ----------

test("drivers.json stores no phone numbers or contacts", () => {
  const text = readFileSync(new URL("../data/drivers.json", import.meta.url), "utf8");
  assert.doesNotMatch(text, /phone|tel|whatsapp|telegram|email|contact|@/i);
  assert.doesNotMatch(text, /\+?\d[\d\s()-]{7,}\d/); // no digit sequences that look like a phone number
  const allowed = ["id", "name", "vehicleType", "seats", "routes", "pricePerTrip", "languages", "verified", "consent", "isDemo"];
  for (const d of drivers) assert.deepEqual(Object.keys(d).sort(), [...allowed].sort());
});

test("drivers: first name only, valid fields, routes point to real places", () => {
  assert.ok(drivers.length >= 3 && drivers.length <= 4);
  for (const d of drivers) {
    assert.match(d.name, /^\p{Lu}\p{Ll}+$/u, `${d.id}: first name only`);
    assert.ok(["sedan", "minivan", "4x4"].includes(d.vehicleType));
    assert.ok(d.seats >= 1 && d.seats <= 8);
    assert.ok(d.pricePerTrip.min > 0 && d.pricePerTrip.min <= d.pricePerTrip.max);
    assert.equal(d.pricePerTrip.currency, "KZT");
    for (const r of d.routes) assert.ok(place(r), `${d.id}: unknown place ${r}`);
    for (const l of d.languages) assert.match(l, /^[a-z]{2}$/);
  }
});

test("pilot: every driver is demo data and not verified", () => {
  for (const d of drivers) {
    assert.equal(d.isDemo, true);
    assert.equal(d.verified, false);
    assert.equal(typeof d.consent, "boolean");
  }
});

// ---------- road status ----------

test("every nature place has an approximate, unverified road status", () => {
  for (const p of places.filter((x: { categories: string[] }) => x.categories.includes("nature"))) {
    const r = p.roadStatus;
    assert.ok(r, `${p.id}: roadStatus missing`);
    assert.ok(["open", "limited", "closed"].includes(r.status));
    assert.ok(r.note.length > 10);
    assert.match(r.lastChecked, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.source.length > 0);
    assert.equal(r.verified, false);
  }
});

test("the four featured places come first in the catalog order", async () => {
  const { FEATURED_PLACE_IDS, featuredFirst } = await import("../lib/featured.ts");
  assert.deepEqual(featuredFirst(places).slice(0, 4).map((p: { id: string }) => p.id), FEATURED_PLACE_IDS);
  assert.equal(featuredFirst(places).length, places.length);
});

test("a place with a closed road is removed by the server; a limited one is kept and flagged", () => {
  const closed = places.find((p: { roadStatus?: { status: string } }) => p.roadStatus?.status === "closed");
  const limited = places.find((p: { roadStatus?: { status: string } }) => p.roadStatus?.status === "limited");
  assert.ok(closed && limited);
  const r = validatePlan(plan([[item({ placeId: closed.id }), item({ placeId: limited.id })]]), db, { days: 1, travellers: 1 });
  assert.deepEqual(r.plan.days[0].items.map((i) => i.placeId), [limited.id]);
  assert.equal(r.plan.days[0].items[0].road, "limited");
  assert.deepEqual(r.plan.roadClosed, [closed.id]);
  assert.equal(r.validation.roadClosedRemoved, 1);
});

// ---------- driver costs: chosen by id, calculated by the server ----------

test("driver price comes from the database: one trip day for the whole car, split by the group", () => {
  const d = driver("demo-aidos"); // 4 seats
  const p = plan([[item({ placeId: "charyn", driverId: d.id })]]);
  const r = validatePlan(p, db, { days: 1, travellers: 2, conditions: conditions("public") });
  const c = r.plan.days[0].items[0].costs!.find((x) => x.source === "driver")!;
  assert.equal(c.id, d.id);
  assert.deepEqual(c.group, { min: d.pricePerTrip.min, max: d.pricePerTrip.max });
  assert.deepEqual(c.perPerson, { min: d.pricePerTrip.min / 2, max: d.pricePerTrip.max / 2 });
  assert.equal(r.plan.days[0].items[0].driverId, d.id);
  assert.equal(r.validation.driverRefsValid, 1);
});

test("a group larger than the car needs two cars", () => {
  const d = driver("demo-dana"); // 3 seats
  const r = validatePlan(plan([[item({ placeId: "big-almaty-lake", driverId: d.id })]]), db, { days: 1, travellers: 5 });
  const c = r.plan.days[0].items[0].costs!.find((x) => x.source === "driver")!;
  assert.equal(c.units, 2);
  assert.equal(c.group.min, d.pricePerTrip.min * 2);
});

test("the driver is paid once per day; other items that day show 0 ₸ 'included'", () => {
  const p = plan([[
    item({ isTransfer: true, driverId: "demo-aidos" }),
    item({ placeId: "charyn", driverId: "demo-aidos" }),
    item({ isTransfer: true, driverId: "demo-aidos" }),
  ]]);
  const r = validatePlan(p, db, { days: 1, travellers: 1, conditions: conditions("public") });
  const items = r.plan.days[0].items;
  assert.equal(items[0].costs![0].source, "driver");
  assert.equal(items[1].costs![0].id, "by-driver");
  assert.equal(items[2].costs![0].id, "by-driver");
  assert.equal(r.totals.perPerson.min, driver("demo-aidos").pricePerTrip.min);
  assert.equal(r.totals.unknownCount, 0);
});

test("invented driver ids and drivers who do not go to that place are dropped", () => {
  const p = plan([[item({ placeId: "charyn", driverId: "ghost" }), item({ placeId: "kapchagay", driverId: "demo-aidos" })]]);
  const r = validatePlan(p, db, { days: 1, travellers: 1 });
  assert.ok(r.plan.days[0].items.every((i) => !i.costs?.some((c) => c.source === "driver")));
  assert.equal(r.validation.driverRefs, 2);
  assert.equal(r.validation.driverRefsValid, 0);
});

test("on a rental-car day there is no driver (they drive themselves)", () => {
  const p = plan([[item({ placeId: "charyn", isTransfer: true, driverId: "demo-aidos" })]]);
  const r = validatePlan(p, db, { days: 1, travellers: 1, conditions: conditions("rental") });
  assert.ok(!r.plan.days[0].items[0].costs?.some((c) => c.source === "driver"));
  assert.ok(r.plan.days[0].dayCosts.some((c) => c.id === "car-rental"));
});

test("with a driver the place's tour price is not paid twice; entry is still paid", () => {
  const p = plan([[item({ placeId: "charyn", priceIds: ["entry", "tour"], driverId: "demo-marat" })]]);
  const r = validatePlan(p, db, { days: 1, travellers: 1, conditions: conditions("public") });
  const ids = r.plan.days[0].items[0].costs!.map((c) => c.id);
  assert.ok(ids.includes("entry"));
  assert.ok(!ids.includes("tour"));
  assert.ok(ids.includes("demo-marat"));
});

test("without drivers in the database old plans still validate (no driver costs)", () => {
  const r = validatePlan(plan([[item({ placeId: "charyn", driverId: "demo-aidos", priceIds: ["tour"] })]]), { places, costs }, { days: 1, travellers: 1 });
  assert.deepEqual(r.plan.days[0].items[0].costs!.map((c) => c.id), ["tour"]);
});

// ---------- "Request a driver" (WhatsApp) ----------

test("WhatsApp number: digits only; empty or invalid → no button", () => {
  assert.equal(whatsappNumber("77772008305"), "77772008305");
  assert.equal(whatsappNumber("+7 777 200 83 05"), "77772008305");
  assert.equal(whatsappNumber(""), null);
  assert.equal(whatsappNumber(undefined), null);
  assert.equal(whatsappNumber("123"), null);
});

test("request message: places by day, days, group size, language; link is wa.me with encoded text", () => {
  const msg = requestMessage({
    title: "Canyons & lakes",
    days: [
      { day: 1, places: ["Charyn Canyon"], driver: "Aidos (demo profile)" },
      { day: 2, places: [] },
      { day: 3, places: ["Kolsai Lakes", "Kaindy Lake"] },
    ],
    totalDays: 3,
    travellers: 2,
    language: "German",
    date: "2026-12-05",
  });
  assert.match(msg, /Day 1: Charyn Canyon \(suggested driver: Aidos \(demo profile\)\)/);
  assert.doesNotMatch(msg, /Day 2:/);
  assert.match(msg, /Day 3: Kolsai Lakes, Kaindy Lake/);
  assert.match(msg, /Days: 3/);
  assert.match(msg, /Travellers: 2/);
  assert.match(msg, /Language: German/);
  assert.match(msg, /Preferred start date: 2026-12-05/);
  const link = whatsappLink("77772008305", msg);
  assert.ok(link.startsWith("https://wa.me/77772008305?text="));
  assert.equal(decodeURIComponent(link.split("?text=")[1]), msg);
});

test("request message ignores a malformed date", () => {
  const msg = requestMessage({ title: "", days: [], totalDays: 1, travellers: 1, language: "English", date: "tomorrow" });
  assert.doesNotMatch(msg, /date/i);
});

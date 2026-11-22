// Translations: pre-translated files, parts for live AI translation, quality checks. No AI calls. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { en } from "../lib/dictionaries.ts";
import { LANGUAGES } from "../lib/languages.ts";
import {
  acceptTranslation,
  flattenPlaces,
  freshValues,
  partsOf,
  placeholders,
  placeTexts,
  PLACES_PART_SIZE,
  PRETRANSLATED,
  PRETRANSLATED_PLACES,
  readAnswer,
  runPool,
  textHash,
  translatePrompt,
  UI_PART_SIZE,
  unflattenPlaces,
  untranslatedShare,
  valueProblem,
  type Flat,
} from "../lib/translation.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const places = read("../data/places.json");
const costs = read("../data/costs.json") as { id: string; label: string }[];
const UI = en as unknown as Flat;
const ORIGINAL = Object.fromEntries(places.map((p: { id: string }) => [p.id, placeTexts(p as never)]));
const COST_LABELS = Object.fromEntries(costs.map((c) => [c.id, c.label]));
const PLACES_FLAT = flattenPlaces(ORIGINAL, COST_LABELS);

// ---------- the list of languages ----------

test("the ten popular languages are pre-translated and listed first (after English), before AI-only languages", () => {
  assert.deepEqual([...PRETRANSLATED].sort(), ["ar", "de", "es", "fr", "hi", "ja", "ko", "tr", "uz", "zh"]);
  const order = LANGUAGES.map((l) => l.code);
  assert.equal(order[0], "en");
  assert.deepEqual(order.slice(1, 11), [...PRETRANSLATED]);
  const ready = new Set(["en", "kk", "ru", ...PRETRANSLATED]);
  const firstAi = order.findIndex((c) => !ready.has(c));
  assert.ok(order.slice(firstAi).every((c) => !ready.has(c)), "instant languages come before AI-only ones");
});

// ---------- pre-translated files ----------

for (const code of PRETRANSLATED_PLACES) {
  const url = new URL(`../public/locales/${code}.json`, import.meta.url);
  // Until the file is generated (node scripts/translate-locales.mts), the language is translated live by AI.
  const skip = existsSync(url) ? false : "not generated yet — this language uses live AI translation";
  test(`public/locales/${code}.json: complete, up to date and passes the quality checks`, { skip }, () => {
    const f = JSON.parse(readFileSync(url, "utf8"));
    const lang = LANGUAGES.find((l) => l.code === code)!;
    assert.equal(f.code, code);
    assert.equal(f.dir, lang.dir ?? "ltr");
    const sets: [Flat, Flat, Record<string, string>][] = [[PLACES_FLAT, f.places, f.placesSource]];
    if (code !== "kk" && code !== "ru") sets.push([UI, f.ui, f.uiSource]);
    for (const [source, values, hashes] of sets) {
      const fresh = freshValues(source, values, hashes);
      const missing = Object.keys(source).filter((k) => !(k in fresh));
      assert.deepEqual(missing, [], "missing or outdated strings: run node scripts/translate-locales.mts " + code);
      for (const [k, v] of Object.entries(fresh)) assert.equal(valueProblem(source[k], v), null, `${k}: ${valueProblem(source[k], v)}`);
      assert.ok(untranslatedShare(code, source, fresh) <= 0.1, "too many strings look untranslated");
    }
    // No secrets or personal data slipped into a public file.
    assert.doesNotMatch(JSON.stringify(f), /AIza|tvly-|@gmail/);
  });
}

// ---------- quality checks ----------

test("a value is rejected when placeholders, the brand, ₸ or $ are lost, or it is empty", () => {
  assert.equal(valueProblem("{n} days", "{n} 天"), null);
  assert.equal(valueProblem("{n} days", "3 天"), "placeholders changed");
  assert.equal(valueProblem("{n} days", "{count} 天"), "placeholders changed");
  assert.equal(valueProblem("About QazTrip AI", "关于 QazTrip"), '"QazTrip AI" lost');
  assert.equal(valueProblem("0 ₸", "0 тенге"), '"₸" lost');
  assert.equal(valueProblem("≈ ${amount} approx.", "≈ {amount} 约"), '"$" lost');
  assert.equal(valueProblem("Hello", ""), "empty");
  assert.equal(valueProblem("Hello", 5), "empty");
  assert.equal(valueProblem("Hi", "<b>你好</b>"), "markup added");
  assert.deepEqual(placeholders("{b} and {a}"), ["{a}", "{b}"]);
});

test("acceptTranslation keeps good values for requested keys only", () => {
  const src = { a: "Hello {n}", b: "Bye", c: "Night" };
  const { ok, bad } = acceptTranslation(src, { a: "你好 {n}", b: "", extra: "x" });
  assert.deepEqual(ok, { a: "你好 {n}" });
  assert.deepEqual(bad.sort(), ["b", "c"]);
  assert.deepEqual(acceptTranslation(src, null).bad.length, 3);
});

test("untranslated English is detected (script check for zh/ko/ja/ar/hi)", () => {
  const src = { a: "Plan your trip", b: "Places to visit" };
  assert.equal(untranslatedShare("zh", src, { a: "规划行程", b: "Places to visit" }), 0.5);
  assert.equal(untranslatedShare("ko", src, { a: "여행 계획", b: "방문할 곳" }), 0);
  assert.equal(untranslatedShare("de", src, { a: "Plan your trip", b: "Orte" }), 0.5);
});

test("AI answers: {dir, locale, strings} or a bare object; bad locale tags are dropped", () => {
  assert.deepEqual(readAnswer({ dir: "rtl", locale: "ar", strings: { a: "x" } }), { dir: "rtl", locale: "ar", strings: { a: "x" } });
  assert.deepEqual(readAnswer({ a: "x" }).strings, { a: "x" });
  assert.equal(readAnswer({ locale: "<script>", strings: {} }).locale, "");
  assert.equal(readAnswer(null).dir, "ltr");
  assert.match(translatePrompt("Korean", { a: "Hi" }), /Korean[\s\S]*"a":"Hi"/);
});

// ---------- parts, places, staleness ----------

test("live translation is split into small parts covering every string once", () => {
  for (const [source, size] of [[UI, UI_PART_SIZE], [PLACES_FLAT, PLACES_PART_SIZE]] as const) {
    const parts = partsOf(Object.keys(source), size);
    assert.ok(parts.every((p) => p.length > 0 && p.length <= size));
    assert.deepEqual(parts.flat(), Object.keys(source));
    assert.ok(parts.length <= 15, "few enough calls per language");
  }
});

test("places flatten and unflatten without losing anything; missing strings stay English", () => {
  const back = unflattenPlaces(ORIGINAL, COST_LABELS, PLACES_FLAT);
  assert.deepEqual(back.places, ORIGINAL);
  assert.deepEqual(back.costs, COST_LABELS);
  const partial = unflattenPlaces(ORIGINAL, COST_LABELS, { "p.charyn.name": "恰伦峡谷", "c.metro": "地铁" });
  assert.equal(partial.places.charyn.name, "恰伦峡谷");
  assert.equal(partial.places.charyn.description, ORIGINAL.charyn.description);
  assert.equal(partial.costs.metro, "地铁");
  assert.equal(partial.costs.bus, COST_LABELS.bus);
});

test("a pre-translated string whose English source changed is not used (English instead)", () => {
  const source = { a: "New text", b: "Same" };
  const values = { a: "旧文本", b: "相同" };
  const hashes = { a: textHash("Old text"), b: textHash("Same") };
  assert.deepEqual(freshValues(source, values, hashes), { b: "相同" });
});

test("runPool runs every item with limited concurrency", async () => {
  let running = 0;
  let peak = 0;
  const done: number[] = [];
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    done.push(n);
    running--;
  });
  assert.equal(peak, 3);
  assert.deepEqual(done.sort(), [1, 2, 3, 4, 5, 6, 7]);
});

// ---------- the API route stays inside the Vercel time limit and needs no huge schema ----------

test("translate route: short limits, no response schema, parts", () => {
  const src = readFileSync(new URL("../app/api/translate/route.ts", import.meta.url), "utf8");
  assert.match(src, /maxDuration = 30/);
  const budget = Number(/budgetMs: ([\d_]+)/.exec(src)![1].replace(/_/g, ""));
  assert.ok(budget < 30_000, "AI budget below the function limit");
  assert.doesNotMatch(src, /^s*schema:/m); // no JSON schema passed to the model
  assert.match(src, /part/);
});

test("the notice when translation fails is the agreed English text", () => {
  assert.equal(en["errors.translate"], "Translation is temporarily unavailable, showing English");
});

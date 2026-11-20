// Approximate USD next to ₸ prices; and "local driver" wording. No AI calls. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KZT_PER_USD, kztToUsd, usdAmount } from "../lib/currency.ts";
import { en, BUILTIN } from "../lib/dictionaries.ts";

test("one fixed rate kept in one place: 1 USD = 500 ₸", () => {
  assert.equal(KZT_PER_USD, 500);
  const files = ["components/LanguageProvider.tsx", "components/Usd.tsx", "app/planner/page.tsx"];
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\b500\b/, `${f}: the rate must come from lib/currency.ts`);
  }
});

test("₸ → USD rounding", () => {
  assert.equal(kztToUsd(20000), 40);
  assert.equal(kztToUsd(35250), 71); // 70.5 → 71
  assert.equal(kztToUsd(150), 0.3);
  assert.equal(kztToUsd(10), 0.1); // never shows $0 for a paid item
  assert.equal(kztToUsd(0), 0);
  assert.equal(kztToUsd(-5), 0);
  assert.equal(kztToUsd(Number.NaN), 0);
});

test("USD amount and range; free → empty (no USD next to free items)", () => {
  assert.equal(usdAmount(20000), "40");
  assert.equal(usdAmount(20000, 35000), "40–70");
  assert.equal(usdAmount(20000, 20000), "40");
  assert.equal(usdAmount(0, 0), "");
  assert.equal(usdAmount(0, 5000), "0–10");
});

test("USD is always labelled approximate, in every built-in language; ₸ stays the main currency", () => {
  for (const code of Object.keys(BUILTIN)) {
    const d = BUILTIN[code];
    assert.match(d["currency.usd"], /^≈ \$\{amount\} \S+/, `${code}: currency.usd`);
    assert.ok(d["currency.rate"].includes("{rate}") && d["currency.rate"].includes("₸"), `${code}: currency.rate`);
  }
  assert.match(en["currency.usd"], /approx\./);
});

test('"local driver", not "verified driver", in every language (drivers are not verified yet)', () => {
  const text = readFileSync(new URL("../lib/dictionaries.ts", import.meta.url), "utf8");
  assert.doesNotMatch(text, /verified driver|тексерілген жүргізуші|проверенн\w* водител/i);
  assert.match(en["home.title"], /local driver/);
});

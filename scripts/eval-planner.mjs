// AI quality evaluation of the route planner.
// Sends fixed test scenarios to the running site and aggregates the server's validation metrics.
// Usage: start the site (npm run dev), then in another terminal: npm run eval
// Optional: EVAL_URL=http://localhost:3000 npm run eval
import { writeFileSync } from "node:fs";

const BASE = process.env.EVAL_URL ?? "http://localhost:3000";
const DELAY_MS = 16_000; // stay under the planner rate limit (4 requests / minute)

const SCENARIOS = [
  { name: "3 days, nature, EN, solo", travellers: 1, days: 3, budget: 100000, interests: ["nature", "photo"], startCity: "Almaty", language: "English" },
  { name: "1 day, city, low budget, KK, 2 people", travellers: 2, days: 1, budget: 5000, interests: ["city", "food"], startCity: "Almaty", language: "Kazakh" },
  { name: "2 days, history, RU, solo", travellers: 1, days: 2, budget: 60000, interests: ["history", "culture"], startCity: "Almaty", language: "Russian" },
  { name: "4 days, hiking, ZH, 4 people", travellers: 4, days: 4, budget: 200000, interests: ["hiking", "nature"], startCity: "Almaty", language: "Chinese (Simplified)" },
  { name: "2 days, family, from Esik, TR, 5 people", travellers: 5, days: 2, budget: 80000, interests: ["family", "relax"], startCity: "Esik", language: "Turkish" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, b) => (b === 0 ? "n/a" : `${Math.round((a / b) * 100)}%`);

const rows = [];
for (const [i, s] of SCENARIOS.entries()) {
  if (i > 0) await sleep(DELAY_MS);
  const started = Date.now();
  process.stdout.write(`[${i + 1}/${SCENARIOS.length}] ${s.name} … `);
  try {
    const res = await fetch(`${BASE}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...s, extra: "", name: undefined }),
    });
    const data = await res.json();
    const ms = Date.now() - started;
    if (!res.ok) {
      console.log(`ERROR ${res.status} ${data?.error?.code}`);
      rows.push({ scenario: s.name, ok: false, error: data?.error?.code ?? res.status, ms });
      continue;
    }
    const v = data.validation;
    console.log(`ok (${(ms / 1000).toFixed(1)}s)`);
    rows.push({ scenario: s.name, ok: true, ms, model: data.model, fallback: data.fallback, ...v });
  } catch (e) {
    console.log(`ERROR ${e.message}`);
    rows.push({ scenario: s.name, ok: false, error: e.message, ms: Date.now() - started });
  }
}

const ok = rows.filter((r) => r.ok);
const sum = (k) => ok.reduce((a, r) => a + r[k], 0);
const summary = {
  date: new Date().toISOString(),
  url: BASE,
  scenarios: rows.length,
  successful: ok.length,
  successRate: pct(ok.length, rows.length),
  placeMatchRate: pct(sum("placeRefsValid"), sum("placeRefs")),
  priceRefMatchRate: pct(sum("priceRefsValid"), sum("priceRefs")),
  exactDaysRate: pct(ok.filter((r) => r.daysReturned === r.daysRequested).length, ok.length),
  moneyAmountsRemoved: sum("moneyRemoved"),
  unknownCostItemRate: pct(sum("itemsUnknown"), sum("items")),
  fallbackModelRate: pct(ok.filter((r) => r.fallback).length, ok.length),
  avgLatencySec: ok.length ? +(ok.reduce((a, r) => a + r.ms, 0) / ok.length / 1000).toFixed(1) : null,
};

console.log("\nPer scenario:");
console.table(
  rows.map((r) =>
    r.ok
      ? {
          scenario: r.scenario,
          places: `${r.placeRefsValid}/${r.placeRefs}`,
          prices: `${r.priceRefsValid}/${r.priceRefs}`,
          days: `${r.daysReturned}/${r.daysRequested}`,
          moneyRemoved: r.moneyRemoved,
          unknown: `${r.itemsUnknown}/${r.items}`,
          model: r.model,
          sec: +(r.ms / 1000).toFixed(1),
        }
      : { scenario: r.scenario, error: r.error },
  ),
);
console.log("Summary:");
console.table(summary);

writeFileSync("eval-results.json", JSON.stringify({ summary, rows }, null, 2));
console.log("Saved to eval-results.json");

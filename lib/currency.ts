/**
 * Approximate USD equivalents for foreign tourists. ₸ (KZT) stays the main currency:
 * every price is stored and calculated in ₸; USD is only shown next to it, marked "approx.".
 * One fixed rate, kept here only (update it by hand). Pure logic, unit-tested: tests/currency.test.mts.
 */
export const KZT_PER_USD = 500;

/** ₸ → USD, rounded for display: whole dollars from $10, one decimal below (e.g. 150 ₸ → 0.3). */
export function kztToUsd(kzt: number): number {
  if (!Number.isFinite(kzt) || kzt <= 0) return 0;
  const usd = kzt / KZT_PER_USD;
  if (usd >= 10) return Math.round(usd);
  return Math.max(0.1, Math.round(usd * 10) / 10);
}

/** "40" or "40–70" (no sign, no label); "" when the amount is 0 / free. */
export function usdAmount(min: number, max: number = min): string {
  const a = kztToUsd(min);
  const b = kztToUsd(Math.max(min, max));
  if (b === 0) return "";
  return a === b ? `${a}` : `${a}–${b}`;
}

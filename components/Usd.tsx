"use client";

import { useI18n } from "./LanguageProvider";

/** Small "≈ $40–70 approx." next to a ₸ price (₸ stays the main currency). Renders nothing for free items. */
export function Usd({ min, max }: { min: number; max?: number }) {
  const { formatUsd } = useI18n();
  const s = formatUsd(min, max);
  if (!s) return null;
  return <span className="whitespace-nowrap text-xs font-normal text-muted"> {s}</span>;
}

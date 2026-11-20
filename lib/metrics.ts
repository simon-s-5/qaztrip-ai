import "server-only";
import type { PlanValidation } from "./planValidation";

/**
 * Aggregated AI quality metrics since the server started (in memory, per instance).
 * Nothing about users is stored — only counters.
 */
const m = {
  since: new Date().toISOString(),
  plans: 0,
  planFallbacks: 0,
  planErrors: 0,
  daysExact: 0,
  items: 0,
  itemsUnknown: 0,
  placeRefs: 0,
  placeRefsValid: 0,
  priceRefs: 0,
  priceRefsValid: 0,
  moneyRemoved: 0,
  overBudget: 0,
  replans: 0,
  replansCheaper: 0,
  replansFit: 0,
  chats: 0,
  chatFallbacks: 0,
  chatSearches: 0,
  chatSearchesWithSources: 0,
  chatErrors: 0,
};

export function recordPlan(v: PlanValidation, fallback = false) {
  if (fallback) m.planFallbacks++;
  m.plans++;
  if (v.daysReturned === v.daysRequested) m.daysExact++;
  m.items += v.items;
  m.itemsUnknown += v.itemsUnknown;
  m.placeRefs += v.placeRefs;
  m.placeRefsValid += v.placeRefsValid;
  m.priceRefs += v.priceRefs;
  m.priceRefsValid += v.priceRefsValid;
  m.moneyRemoved += v.moneyRemoved;
}

export function recordPlanError() {
  m.planErrors++;
}

export function recordChat(searched: boolean, sources: number, fallback = false) {
  if (fallback) m.chatFallbacks++;
  m.chats++;
  if (searched) m.chatSearches++;
  if (searched && sources > 0) m.chatSearchesWithSources++;
}

export function recordChatError() {
  m.chatErrors++;
}

export function getMetrics() {
  return { ...m };
}

/** Budget feedback loop: first plan over budget → one AI re-plan → cheaper? fits? */
export function recordBudgetCheck(c: { attempted: boolean; revised: boolean; fits: boolean; original: { min: number } }) {
  if (!c.attempted && c.fits) return;
  m.overBudget++;
  if (c.attempted) m.replans++;
  if (c.revised) m.replansCheaper++;
  if (c.revised && c.fits) m.replansFit++;
}

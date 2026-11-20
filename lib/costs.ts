import costsData from "@/data/costs.json";

/**
 * General travel costs (transport, meals, accommodation).
 * unit "person": price per person; "vehicle"/"room": price per car or room shared by up to `capacity` people.
 */
export type GeneralCost = {
  id: string;
  category: "transport" | "food" | "accommodation";
  label: string;
  unit: "person" | "vehicle" | "room";
  capacity: number;
  min: number;
  max: number;
  currency: "KZT";
  verified: boolean;
  source: string;
};

export const COSTS = costsData as GeneralCost[];

export const COST_IDS = COSTS.map((c) => c.id);

export function getCost(id: string): GeneralCost | undefined {
  return COSTS.find((c) => c.id === id);
}

/** Compact view given to the AI. */
export function costsForPrompt() {
  return COSTS.map((c) => ({
    id: c.id,
    category: c.category,
    label: c.label,
    rangeKZT: `${c.min}-${c.max}`,
    verified: c.verified,
  }));
}

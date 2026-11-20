import placesData from "@/data/places.json";

export type Price = {
  id: string;
  label: string;
  min: number;
  max: number;
  currency: "KZT";
  verified: boolean;
};

export type Place = {
  id: string;
  name: string;
  nameKk: string;
  categories: string[];
  distanceFromAlmatyKm: number;
  region: string;
  description: string;
  howToGet: string;
  season: string;
  durationHint: string;
  coordinates: { lat: number; lng: number };
  prices: Price[];
  sourceName: string;
  sourceUrl: string;
};

/** Fields of a place that are translated by AI. */
export type PlaceText = {
  name: string;
  region: string;
  description: string;
  howToGet: string;
  season: string;
  durationHint: string;
  priceLabels: Record<string, string>;
};

export const PLACES = placesData as Place[];

export const PLACE_IDS = PLACES.map((p) => p.id);

export function getPlace(id: string): Place | undefined {
  return PLACES.find((p) => p.id === id);
}

export function placeText(p: Place): PlaceText {
  return {
    name: p.name,
    region: p.region,
    description: p.description,
    howToGet: p.howToGet,
    season: p.season,
    durationHint: p.durationHint,
    priceLabels: Object.fromEntries(p.prices.map((pr) => [pr.id, pr.label])),
  };
}

/** Compact database view given to the AI as its only source of facts. */
export function placesForPrompt() {
  return PLACES.map((p) => ({
    id: p.id,
    name: p.name,
    categories: p.categories,
    distanceFromAlmatyKm: p.distanceFromAlmatyKm,
    season: p.season,
    durationHint: p.durationHint,
    howToGet: p.howToGet,
    prices: p.prices.length
      ? p.prices.map((pr) => ({
          id: pr.id,
          label: pr.label,
          rangeKZT: `${pr.min}-${pr.max}`,
          verified: pr.verified,
        }))
      : "NO PRICE DATA (unknown)",
  }));
}

import placesData from "@/data/places.json";

export type Price = {
  id: string;
  label: string;
  min: number;
  max: number;
  currency: "KZT";
  verified: boolean;
};

export const ROAD_STATUSES = ["open", "limited", "closed"] as const;
export type RoadState = (typeof ROAD_STATUSES)[number];

/** Seasonal road condition of a nature place (approximate until checked by the team). */
export type RoadStatus = {
  status: RoadState;
  note: string;
  /** ISO date (YYYY-MM-DD). */
  lastChecked: string;
  source: string;
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
  roadStatus?: RoadStatus;
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
  /** Road condition note ("" if the place has no road status). */
  roadNote: string;
  priceLabels: Record<string, string>;
};

import { featuredFirst } from "./featured";

export { FEATURED_PLACE_IDS, featuredFirst } from "./featured";

export const PLACES = featuredFirst(placesData as Place[]);

export const PLACE_IDS = PLACES.map((p) => p.id);

export function getPlace(id: string): Place | undefined {
  return PLACES.find((p) => p.id === id);
}

export const isRoadClosed = (p: Pick<Place, "roadStatus"> | undefined) => p?.roadStatus?.status === "closed";

export function placeText(p: Place): PlaceText {
  return {
    name: p.name,
    region: p.region,
    description: p.description,
    howToGet: p.howToGet,
    season: p.season,
    durationHint: p.durationHint,
    roadNote: p.roadStatus?.note ?? "",
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
    ...(p.roadStatus && {
      road: `${p.roadStatus.status.toUpperCase()}: ${p.roadStatus.note} (approximate, checked ${p.roadStatus.lastChecked})`,
    }),
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

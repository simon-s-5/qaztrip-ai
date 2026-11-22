/** English sources to translate and their fixed split into parts (the same for the browser and the API). */
import { en } from "./dictionaries";
import { PLACES, placeText } from "./places";
import { COSTS } from "./costs";
import { flattenPlaces, partsOf, PLACES_PART_SIZE, UI_PART_SIZE, type Flat, type PlaceTexts } from "./translation";

export const ORIGINAL_PLACES: Record<string, PlaceTexts> = Object.fromEntries(PLACES.map((p) => [p.id, placeText(p)]));
export const ORIGINAL_COSTS: Record<string, string> = Object.fromEntries(COSTS.map((c) => [c.id, c.label]));

export const SOURCES: Record<"ui" | "places", Flat> = {
  ui: en as unknown as Flat,
  places: flattenPlaces(ORIGINAL_PLACES, ORIGINAL_COSTS),
};

export const PARTS: Record<"ui" | "places", string[][]> = {
  ui: partsOf(Object.keys(SOURCES.ui), UI_PART_SIZE),
  places: partsOf(Object.keys(SOURCES.places), PLACES_PART_SIZE),
};

import driversData from "@/data/drivers.json";

export const VEHICLE_TYPES = ["sedan", "minivan", "4x4"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/**
 * A driver in our database. No phone numbers or other contacts are stored: requests go to the
 * QazTrip team (WhatsApp) and are handled by a human, who contacts the driver.
 */
export type Driver = {
  id: string;
  /** First name only. */
  name: string;
  vehicleType: VehicleType;
  seats: number;
  /** Place ids this driver goes to. */
  routes: string[];
  /** One trip day: the whole car with the driver, fuel included. */
  pricePerTrip: { min: number; max: number; currency: "KZT"; per: "day" };
  /** Language codes (ISO 639-1). */
  languages: string[];
  verified: boolean;
  /** The driver agreed to be listed. */
  consent: boolean;
  /** Made-up record for the pilot demo (shown with a "Demo data" label). */
  isDemo: boolean;
};

/** Only demo records or drivers who gave consent may be shown or used by the AI. */
export const isListable = (d: Driver) => d.isDemo || d.consent;

export const DRIVERS = (driversData as Driver[]).filter(isListable);

export const DRIVER_IDS = DRIVERS.map((d) => d.id);

export function getDriver(id: string | null | undefined): Driver | undefined {
  return id ? DRIVERS.find((d) => d.id === id) : undefined;
}

export function driversForPlace(placeId: string): Driver[] {
  return DRIVERS.filter((d) => d.routes.includes(placeId));
}

/** Compact view given to the AI (no prices needed for choosing, but shown as a hint). */
export function driversForPrompt() {
  return DRIVERS.map((d) => ({
    id: d.id,
    vehicleType: d.vehicleType,
    seats: d.seats,
    routes: d.routes,
    languages: d.languages,
    pricePerDayKZT: `${d.pricePerTrip.min}-${d.pricePerTrip.max} (whole car)`,
  }));
}

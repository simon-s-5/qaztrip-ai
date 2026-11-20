/**
 * "Request a driver": builds a ready WhatsApp message from the tourist's route.
 * Nothing is sent to or stored on our server — the browser only opens a wa.me link,
 * and during the pilot the QazTrip team handles the request by hand.
 * Pure functions (no imports) so they can be unit-tested: see tests/drivers.test.mts.
 */

export type RequestDay = { day: number; places: string[]; driver?: string | null };

export type DriverRequest = {
  title: string;
  days: RequestDay[];
  totalDays: number;
  travellers: number;
  /** The tourist's language, e.g. "English". */
  language: string;
  /** Optional travel date (YYYY-MM-DD), typed by the tourist. */
  date?: string;
};

/** Digits of the public business number (NEXT_PUBLIC_REQUEST_WHATSAPP), or null → the button is hidden. */
export function whatsappNumber(raw: string | undefined | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** The message is in English so the team can read every request; the tourist's language is stated in it. */
export function requestMessage(r: DriverRequest): string {
  const lines = ["Hello QazTrip! I would like to request a driver for this route."];
  if (r.title.trim()) lines.push(`Route: ${clean(r.title, 120)}`);
  for (const d of r.days) {
    if (d.places.length === 0) continue;
    const driver = d.driver ? ` (suggested driver: ${clean(d.driver, 40)})` : "";
    lines.push(`Day ${d.day}: ${d.places.map((p) => clean(p, 60)).join(", ")}${driver}`);
  }
  lines.push(`Days: ${r.totalDays}`, `Travellers: ${r.travellers}`, `Language: ${clean(r.language, 40)}`);
  if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) lines.push(`Preferred start date: ${r.date}`);
  return lines.join("\n");
}

export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

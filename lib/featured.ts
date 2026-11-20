/** The main nature trips for independent foreign travellers: always listed first. Pure (tested in tests/drivers.test.mts). */
export const FEATURED_PLACE_IDS = ["charyn", "kolsai", "kaindy", "big-almaty-lake"];

/** Featured places first (in that order), then the rest in database order. */
export function featuredFirst<T extends { id: string }>(list: T[]): T[] {
  const rank = (id: string) => {
    const i = FEATURED_PLACE_IDS.indexOf(id);
    return i === -1 ? FEATURED_PLACE_IDS.length : i;
  };
  return list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p.id) - rank(b.p.id) || a.i - b.i)
    .map((x) => x.p);
}

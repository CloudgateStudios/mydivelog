/**
 * Geography, for site clustering.
 *
 * Each dive in the seed UDDF created a fresh site record, so sites 200 m apart
 * are separate rows describing the same reef. Deduplicating them needs
 * distance, not equality.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export type Coordinates = { lat: number; lon: number };

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than a flat-earth approximation: the error of treating
 * degrees as a plane grows with latitude, and dive sites exist from Svalbard
 * to the Ross Sea. The cost is a few trig calls on a comparison that only runs
 * against nearby candidates anyway.
 */
export function distanceM(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidCoordinate(value: Coordinates | undefined): value is Coordinates {
  if (!value) return false;
  const { lat, lon } = value;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  // 0,0 is in the Gulf of Guinea and is overwhelmingly a missing value that a
  // writer filled with zeroes. Refusing it costs one improbable dive site and
  // prevents every unlocated dive in a file from clustering into one place.
  return !(lat === 0 && lon === 0);
}

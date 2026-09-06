/**
 * Where a diver has dived, as coordinates on a plot.
 *
 * Deliberately not a basemap. A tile server is handed the coordinates of
 * everywhere it renders, and docs/10-security-privacy.md is explicit that dive
 * locations are the most sensitive thing in this product — they reveal where
 * someone lives and when they are away from home. Sending them to a third
 * party by default is the exact risk the threat model names, and the web app's
 * own Content-Security-Policy would refuse the tiles anyway.
 *
 * So this projects the diver's own sites into a box and draws nothing else.
 * The box is fitted to their dives rather than being the whole world, which
 * makes it useful at both scales: someone who only dives Bonaire sees which
 * site is south of which, and someone who dives Bonaire and Hawaii sees two
 * clusters an ocean apart.
 *
 * Equirectangular, because it keeps latitude and longitude linear and this is
 * a locator plot rather than a chart of areas. Longitude is scaled by the
 * cosine of the centre latitude so a bay does not come out stretched.
 */

export type MappableSite = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  dives: number;
};

export type PlottedSite = MappableSite & {
  x: number;
  y: number;
  /** Whether this site's name is drawn. See `placeLabels`. */
  showLabel: boolean;
};

export type SiteMap = {
  sites: PlottedSite[];
  width: number;
  height: number;
  /** Corner labels, so the plot says where in the world it is. */
  bounds: { north: number; south: number; east: number; west: number };
  /** How far across the plot is, for the caption. */
  spanKm: number;
};

const EARTH_KM_PER_DEGREE = 111.32;

/**
 * A minimum span, in degrees, so a cluster of sites 200 m apart does not fill
 * the plot and imply a continent. Roughly 5 km.
 */
const MIN_SPAN_DEG = 0.045;

export function buildSiteMap(
  sites: readonly MappableSite[],
  box: { width: number; height: number; padding: number } = {
    width: 900,
    height: 460,
    padding: 34,
  },
): SiteMap | undefined {
  const located = sites.filter(
    (s) =>
      Number.isFinite(s.latitude) &&
      Number.isFinite(s.longitude) &&
      Math.abs(s.latitude) <= 90 &&
      Math.abs(s.longitude) <= 180,
  );
  if (located.length === 0) return undefined;

  const lats = located.map((s) => s.latitude);
  const lons = located.map((s) => s.longitude);

  // Padded so a marker on the edge is not half outside the plot, and floored
  // so a single site still gets a box rather than a division by zero.
  const centreLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const latSpan = Math.max(Math.max(...lats) - Math.min(...lats), MIN_SPAN_DEG) * 1.25;
  const lonSpan = Math.max(Math.max(...lons) - Math.min(...lons), MIN_SPAN_DEG) * 1.25;

  const north = centreLat + latSpan / 2;
  const south = centreLat - latSpan / 2;
  const centreLon = (Math.max(...lons) + Math.min(...lons)) / 2;
  const east = centreLon + lonSpan / 2;
  const west = centreLon - lonSpan / 2;

  const plotWidth = box.width - box.padding * 2;
  const plotHeight = box.height - box.padding * 2;

  const x = (lon: number): number => box.padding + ((lon - west) / (east - west)) * plotWidth;
  // Latitude increases northward and y increases downward.
  const y = (lat: number): number => box.padding + ((north - lat) / (north - south)) * plotHeight;

  return {
    sites: placeLabels(
      located.map((site) => ({
        ...site,
        x: round(x(site.longitude)),
        y: round(y(site.latitude)),
        showLabel: true,
      })),
    ),
    width: box.width,
    height: box.height,
    bounds: { north, south, east, west },
    // A longitude degree narrows toward the poles; at 12°N it is nearly a full
    // one, at 70°N it is a third. Ignoring that would call a Norwegian fjord
    // three times wider than it is.
    spanKm: round((east - west) * EARTH_KM_PER_DEGREE * Math.cos((centreLat * Math.PI) / 180)),
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** Roughly what a name occupies at the label font size, in plot units. */
const LABEL_HEIGHT = 15;
const CHAR_WIDTH = 6.2;

/**
 * Which names can be drawn without landing on top of each other.
 *
 * Bonaire's west coast is a line of shore sites a few hundred metres apart, so
 * on any plot wide enough to also show Hawaii their labels overlap into an
 * unreadable smear — which is worse than no labels, because it looks like a
 * rendering bug rather than a dense cluster.
 *
 * Most-dived first, so when two collide the one the diver knows better keeps
 * its name. A site that loses its label still gets its marker, and the table
 * below the plot names every one of them.
 */
export function placeLabels(sites: readonly PlottedSite[]): PlottedSite[] {
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];

  const byPriority = [...sites].sort((a, b) => b.dives - a.dives || a.name.localeCompare(b.name));
  const decided = new Map<string, boolean>();

  for (const site of byPriority) {
    const halfWidth = (site.name.length * CHAR_WIDTH) / 2;
    const box = {
      left: site.x - halfWidth,
      right: site.x + halfWidth,
      // The label sits above the marker.
      top: site.y - 14 - LABEL_HEIGHT,
      bottom: site.y - 14,
    };
    const overlaps = placed.some(
      (other) =>
        box.left < other.right &&
        box.right > other.left &&
        box.top < other.bottom &&
        box.bottom > other.top,
    );
    decided.set(site.id, !overlaps);
    if (!overlaps) placed.push(box);
  }

  // Returned in the original order so the caller's markers do not reshuffle.
  return sites.map((site) => ({ ...site, showLabel: decided.get(site.id) ?? false }));
}

/** "12.10°N 68.29°W" — the form a chart plotter and a dive guide both use. */
export function formatCoordinates(latitude: number, longitude: number, places = 4): string {
  const lat = `${Math.abs(latitude).toFixed(places)}°${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(longitude).toFixed(places)}°${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

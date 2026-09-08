/**
 * Where the basemap comes from.
 *
 * Read in one place because two things have to agree about it: the map itself,
 * and the Content-Security-Policy in `next.config.ts` that decides whether the
 * browser is allowed to fetch it. They were separate once and the map silently
 * rendered a grey grid, because a blocked image is not an error anyone sees.
 *
 * **This is a privacy decision, not a configuration detail.** Every tile the
 * browser requests names a square of the world containing a dive site, and the
 * provider learns it along with the diver's IP. `docs/10-security-privacy.md`
 * rates dive locations the most sensitive thing this product holds. It is a
 * deliberate, owner-made trade for a map people can actually read — but the
 * consequence is that whoever serves these tiles is a sub-processor, named on
 * /legal/privacy, and swapping them is a policy change rather than an edit.
 */

export type TileSource = {
  /** Leaflet URL template. `{s}` subdomains are deliberately unused. */
  url: string;
  /** Shown on the map. Required by every provider worth using, OSM included. */
  attribution: string;
  /** The origins the CSP has to admit for the tiles to load at all. */
  hosts: string[];
  maxZoom: number;
};

/**
 * OpenStreetMap's own tiles, which are the default only because they need no
 * key and make local development work with nothing configured.
 *
 * Their Tile Usage Policy asks that production services not depend on them.
 * Set MAP_TILE_URL and MAP_TILE_ATTRIBUTION to a provider with a plan before
 * this carries real traffic — see docs/runbooks/map-tiles.md.
 */
const OPENSTREETMAP: TileSource = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  hosts: ['https://tile.openstreetmap.org'],
  maxZoom: 19,
};

export function tileSource(): TileSource {
  const url = process.env['MAP_TILE_URL'];
  if (!url) return OPENSTREETMAP;

  const attribution = process.env['MAP_TILE_ATTRIBUTION'];
  if (!attribution) {
    // Attribution is a licence condition for OpenStreetMap data and a
    // contractual one for every commercial provider. A map without it is not a
    // map we are allowed to show.
    throw new Error(
      'MAP_TILE_URL is set but MAP_TILE_ATTRIBUTION is not. Every tile provider requires ' +
        'attribution; see docs/runbooks/map-tiles.md.',
    );
  }

  return {
    url,
    attribution,
    hosts: [originOf(url)],
    maxZoom: Number(process.env['MAP_TILE_MAX_ZOOM'] ?? 19),
  };
}

/**
 * The origin a CSP entry needs, from a template full of `{z}/{x}/{y}`.
 *
 * Those braces are not valid in a URL, so `new URL` on the raw template throws
 * on some providers and silently mangles others. The placeholders are replaced
 * with digits first.
 */
function originOf(template: string): string {
  const probe = template.replace(/\{[sxyzr]\}/g, '1').replace(/\{[^}]*\}/g, 'x');
  try {
    return new URL(probe).origin;
  } catch {
    throw new Error(`MAP_TILE_URL is not a URL: ${template}`);
  }
}

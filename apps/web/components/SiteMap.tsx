import type { SiteMap as Projection } from '@mydivelog/domain';
import { formatCoordinates } from '@mydivelog/domain';

/**
 * Where the diver has been, plotted.
 *
 * This is the fallback now, not the whole story. `SiteTileMap` replaces it
 * with a real basemap once Leaflet has loaded; what stays here is what a
 * reader gets before that, if the bundle never arrives, or with scripting off.
 *
 * It draws the diver's own coordinates and fetches nothing, so it is also the
 * version that reveals a dive site to nobody. That used to be the whole
 * argument for having only this — see docs/10-security-privacy.md, which now
 * records the trade that was made instead and why.
 */
export function SiteMap({ map, unlocated }: { map: Projection; unlocated: number }) {
  const biggest = Math.max(...map.sites.map((s) => s.dives), 1);

  return (
    <figure className="site-map">
      <svg
        viewBox={`0 0 ${map.width} ${map.height}`}
        role="img"
        aria-label={`${map.sites.length} located dive sites, spanning about ${Math.round(
          map.spanKm,
        )} kilometres`}
      >
        <rect x={0} y={0} width={map.width} height={map.height} className="sea" />

        {map.sites.map((site) => (
          <g key={site.id}>
            {/* Area scales with the dive count, so twice the dives is twice
                the ink rather than twice the radius, which would look like
                four times as many. */}
            <circle
              cx={site.x}
              cy={site.y}
              r={5 + 9 * Math.sqrt(site.dives / biggest)}
              className="site-dot"
            />
            {site.showLabel && (
              <text x={site.x} y={site.y - 14} className="site-label" textAnchor="middle">
                {site.name}
              </text>
            )}
          </g>
        ))}

        <text x={10} y={18} className="axis">
          {formatCoordinates(map.bounds.north, map.bounds.west, 2)}
        </text>
        <text x={map.width - 10} y={map.height - 8} className="axis" textAnchor="end">
          {formatCoordinates(map.bounds.south, map.bounds.east, 2)}
        </text>
      </svg>

      <figcaption className="muted small">
        Roughly {Math.round(map.spanKm)} km across. This is a plot of your own coordinates, drawn
        here without fetching anything — the map itself loads in a moment.
        {unlocated > 0 && (
          <>
            {' '}
            {unlocated} {unlocated === 1 ? 'site has' : 'sites have'} no coordinates in any source,
            so {unlocated === 1 ? 'it is' : 'they are'} not shown here.
          </>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * What stands where the plot would be when nothing can be plotted.
 *
 * A spreadsheet almost never carries coordinates — the reference workbook has
 * a Location and a Dive Site column and no latitude anywhere — so a diver who
 * imported one has every site unlocated and had, until now, a page that simply
 * skipped the map with no word about why. Silence reads as breakage, and the
 * fix for it is one import away, which makes saying nothing the worst of the
 * available options.
 */
export function NoSiteMap({ sites }: { sites: number }) {
  return (
    <div className="site-map-empty">
      <p>
        <strong>
          {sites === 1 ? 'Your site has' : `None of your ${sites} sites have`} coordinates yet
        </strong>
        , so there is nothing to plot.
      </p>
      <p className="muted small">
        Coordinates come from dive computers. A spreadsheet records where you were by name; a UDDF
        export records it in degrees. Import one and the sites you already have gain their locations
        — the same site, located, rather than a second copy of it.
      </p>
      <p className="muted small">
        <a href="/import">Import a computer export</a> · <a href="/formats">What works</a>
      </p>
    </div>
  );
}

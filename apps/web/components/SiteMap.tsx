import type { SiteMap as Projection } from '@mydivelog/domain';
import { formatCoordinates } from '@mydivelog/domain';

/**
 * Where the diver has been, plotted.
 *
 * Not a basemap, and the caption says so rather than letting anyone assume
 * otherwise. A tile server is handed the coordinates of everything it renders,
 * and docs/10-security-privacy.md names dive locations as the most sensitive
 * thing in this product — they say where someone lives and when they are away
 * from it. The app's own Content-Security-Policy would block the tiles anyway.
 *
 * What this gives instead is the part a diver actually uses: which site is
 * where relative to the others, and the exact coordinates to paste into
 * whatever chart or map they already trust.
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
        Roughly {Math.round(map.spanKm)} km across. This is a plot of your own coordinates, not a
        map — MyDiveLog does not send your dive locations to a map service.
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

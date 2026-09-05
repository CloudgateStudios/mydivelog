import { buildProfileChart, buildProfileTable, type ProfileSeries } from '@mydivelog/domain';
import type { Units } from '../lib/units';

/**
 * The depth curve.
 *
 * Inline SVG, server-rendered, no charting library — it is one path and two
 * axes, and a dependency here would be carried by every page that shows a
 * dive. The geometry lives in `@mydivelog/domain` so the admin panel and this
 * page cannot drift apart on where the line goes.
 *
 * The table below it is not an extra: an SVG path is a picture of a dive, and
 * a screen reader is handed one alt string for the whole of it. The table is
 * the same dive as a record — a dozen rows, with the deepest sample forced in.
 * It is collapsed rather than hidden, because a sighted diver wanting the
 * numbers behind the curve has nowhere else to get them.
 */
export function ProfileChart({ series, units }: { series: ProfileSeries; units: Units }) {
  const chart = buildProfileChart(series);
  if (!chart) return <p className="muted">Not enough samples to draw this dive.</p>;

  const rows = buildProfileTable(series);
  const deepest = units.depth(chart.maxDepthM);
  const minutes = Math.round(chart.durationS / 60);
  const hasTemperature = rows.some((row) => row.tempC !== undefined);

  return (
    <figure className="profile">
      <svg
        viewBox="0 0 900 280"
        role="img"
        aria-label={`Depth profile: ${chart.sampleCount} samples over ${minutes} minutes, reaching ${deepest}`}
      >
        {chart.depthTicks.map((tick) => (
          <g key={tick.value}>
            <line x1={48} x2={848} y1={tick.y} y2={tick.y} className="grid" />
            <text x={42} y={(tick.y ?? 0) + 4} className="axis" textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}
        {chart.timeTicks.map((tick) => (
          <text key={tick.value} x={tick.x} y={272} className="axis" textAnchor="middle">
            {tick.label}
          </text>
        ))}

        <path d={chart.area} className="depth-area" />
        <path d={chart.path} className="depth-line" />
        {chart.temperaturePath && <path d={chart.temperaturePath} className="temp-line" />}
      </svg>
      <figcaption className="muted small">
        {chart.sampleCount} samples · deepest {deepest}
        {chart.temperaturePath ? ' · temperature shown as the dashed line' : ''}
      </figcaption>

      <details className="profile-table">
        <summary>The same dive as numbers</summary>
        <table>
          <caption className="visually-hidden">
            Depth profile: depth at intervals through the dive, and the deepest point
          </caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col" className="num">
                Depth
              </th>
              {hasTemperature && (
                <th scope="col" className="num">
                  Temperature
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.timeS} className={row.isDeepest ? 'deepest' : undefined}>
                <th scope="row">{units.duration(row.timeS)}</th>
                <td className="num">
                  {units.depth(row.depthM)}
                  {/* Marked in words, not by the row's colour alone. */}
                  {row.isDeepest && <span className="visually-hidden"> — deepest point</span>}
                </td>
                {hasTemperature && <td className="num">{units.temperature(row.tempC ?? null)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

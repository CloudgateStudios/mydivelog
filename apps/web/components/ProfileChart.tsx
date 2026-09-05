import { buildProfileChart, type ProfileSeries } from '@mydivelog/domain';

/**
 * The depth curve.
 *
 * Inline SVG, server-rendered, no charting library — it is one path and two
 * axes, and a dependency here would be carried by every page that shows a
 * dive. The geometry lives in `@mydivelog/domain` so the admin panel and this
 * page cannot drift apart on where the line goes.
 */
export function ProfileChart({ series }: { series: ProfileSeries }) {
  const chart = buildProfileChart(series);
  if (!chart) return <p className="muted">Not enough samples to draw this dive.</p>;

  return (
    <figure className="profile">
      <svg
        viewBox="0 0 900 280"
        role="img"
        aria-label={`Depth profile: ${chart.sampleCount} samples over ${Math.round(
          chart.durationS / 60,
        )} minutes, reaching ${chart.maxDepthM.toFixed(1)} metres`}
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
        {chart.sampleCount} samples · deepest {chart.maxDepthM.toFixed(1)} m
        {chart.temperaturePath ? ' · temperature shown as the dashed line' : ''}
      </figcaption>
    </figure>
  );
}

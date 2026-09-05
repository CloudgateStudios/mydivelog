import type { ProfileSeries } from '@mydivelog/domain';

/**
 * The depth curve, as inline SVG.
 *
 * Server-rendered with no charting library: it is one path and two axes, and a
 * dependency here would be carried by every page that imports this one.
 *
 * Depth increases downward, the way every dive computer in the world draws it.
 * A profile plotted with depth rising would be read wrong at a glance by
 * exactly the people this panel is for.
 */
export function ProfileChart({ series }: { series: ProfileSeries }) {
  const timeS = series.timeS ?? [];
  const depthM = series.depthM ?? [];
  const tempC = series.tempC;

  if (timeS.length < 2 || depthM.length !== timeS.length) {
    return <p className="empty">Not enough samples to draw a curve.</p>;
  }

  const width = 900;
  const height = 260;
  const pad = { top: 12, right: 48, bottom: 28, left: 44 };

  const lastTime = timeS[timeS.length - 1] as number;
  const maxDepth = Math.max(...depthM);
  // Round the depth axis out to a whole number so the gridlines land somewhere
  // a person would choose.
  const depthCeiling = Math.max(5, Math.ceil(maxDepth / 5) * 5);

  const x = (t: number): number => pad.left + (t / lastTime) * (width - pad.left - pad.right);
  const y = (d: number): number => pad.top + (d / depthCeiling) * (height - pad.top - pad.bottom);

  const path = timeS
    .map((t, i) => `${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)},${y(depthM[i] as number).toFixed(1)}`)
    .join(' ');

  // Filled to the surface, which is how the shape reads as a dive rather than
  // as a line chart that happens to go down.
  const area = `${path} L${x(lastTime).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const depthTicks = Array.from({ length: 5 }, (_, i) => (depthCeiling / 4) * i);
  const timeTicks = Array.from({ length: 5 }, (_, i) => (lastTime / 4) * i);

  const tempPath =
    tempC && tempC.length === timeS.length
      ? (() => {
          const min = Math.min(...tempC);
          const max = Math.max(...tempC);
          const span = max - min || 1;
          return timeS
            .map((t, i) => {
              const ty =
                height -
                pad.bottom -
                (((tempC[i] as number) - min) / span) * (height - pad.top - pad.bottom) * 0.35;
              return `${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)},${ty.toFixed(1)}`;
            })
            .join(' ');
        })()
      : undefined;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto', background: '#0b0d11', borderRadius: 4 }}
      role="img"
      aria-label={`Depth profile, ${timeS.length} samples, maximum ${maxDepth.toFixed(1)} metres`}
    >
      {depthTicks.map((d) => (
        <g key={d}>
          <line x1={pad.left} x2={width - pad.right} y1={y(d)} y2={y(d)} stroke="#262b36" />
          <text x={pad.left - 6} y={y(d) + 4} fill="#8b93a7" fontSize="10" textAnchor="end">
            {d.toFixed(0)}m
          </text>
        </g>
      ))}
      {timeTicks.map((t) => (
        <text key={t} x={x(t)} y={height - 8} fill="#8b93a7" fontSize="10" textAnchor="middle">
          {Math.round(t / 60)}min
        </text>
      ))}

      <path d={area} fill="#5aa9e6" fillOpacity="0.16" />
      <path d={path} fill="none" stroke="#5aa9e6" strokeWidth="1.6" />
      {tempPath && (
        <path d={tempPath} fill="none" stroke="#e2b341" strokeWidth="1" strokeDasharray="3 3" />
      )}

      <text x={width - pad.right + 6} y={y(maxDepth) + 4} fill="#5aa9e6" fontSize="10">
        {maxDepth.toFixed(1)}m
      </text>
      {tempC && (
        <text x={width - pad.right + 6} y={16} fill="#e2b341" fontSize="10">
          temp
        </text>
      )}
    </svg>
  );
}

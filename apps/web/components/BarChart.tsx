/**
 * A bar chart that is also a table.
 *
 * Inline SVG, server-rendered, no charting library — these are rectangles, and
 * a dependency here would be shipped to every diver to draw them. The table
 * underneath is not decoration: docs/08-clients.md requires an equivalent for
 * every chart, and a screen reader handed a row of <rect> elements learns
 * nothing at all.
 *
 * The chart itself is aria-hidden rather than labelled, because the table says
 * the same thing better. Labelling both means hearing every number twice.
 */
export type Bar = { label: string; value: number; caption?: string; highlight?: boolean };

export function BarChart({
  bars,
  title,
  valueLabel,
  format = (n: number) => String(n),
}: {
  bars: Bar[];
  title: string;
  valueLabel: string;
  format?: (value: number) => string;
}) {
  if (bars.length === 0) return <p className="muted">Nothing to chart yet.</p>;

  const max = Math.max(...bars.map((b) => b.value), 1);
  const width = 900;
  const height = 220;
  const padding = { top: 10, bottom: 28, left: 0, right: 0 };
  const plotHeight = height - padding.top - padding.bottom;
  const slot = width / bars.length;
  const barWidth = Math.max(4, Math.min(slot * 0.7, 56));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        {bars.map((bar, i) => {
          // A zero-value bar draws nothing, which is right: an empty year
          // should read as absence rather than as a very short bar.
          const barHeight = (bar.value / max) * plotHeight;
          const x = i * slot + (slot - barWidth) / 2;
          return (
            <g key={bar.label}>
              <rect
                x={x}
                y={padding.top + plotHeight - barHeight}
                width={barWidth}
                height={barHeight}
                className={bar.highlight ? 'bar on' : 'bar'}
              />
              <text x={x + barWidth / 2} y={height - 8} className="axis" textAnchor="middle">
                {bar.label}
              </text>
            </g>
          );
        })}
      </svg>

      <details className="chart-table">
        <summary>{title} as numbers</summary>
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{valueLabel}</th>
                <th scope="col" className="num">
                  Dives
                </th>
              </tr>
            </thead>
            <tbody>
              {bars.map((bar) => (
                <tr key={bar.label} className={bar.highlight ? 'deepest' : undefined}>
                  <th scope="row">{bar.caption ?? bar.label}</th>
                  <td className="num">{format(bar.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

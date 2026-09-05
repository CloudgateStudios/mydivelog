import type { ProfileSeries } from './index.ts';

/**
 * Chart geometry for a depth profile.
 *
 * The maths lives here and the styling lives in each app, because two apps now
 * draw this curve and only one of them should own how it is computed. What is
 * a presentation choice — colour, stroke, whether temperature is shown — stays
 * with the app; where the line goes does not.
 *
 * Pure, so the awkward parts have tests: a dive that never left the surface, a
 * single sample, timestamps that do not start at zero.
 */

export type ChartBox = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
};

export type ChartTick = { value: number; x?: number; y?: number; label: string };

export type ProfileChart = {
  /** The depth line. */
  path: string;
  /** The same line closed to the surface, for a fill. */
  area: string;
  /** Temperature, scaled into the lower part of the box. Absent without the channel. */
  temperaturePath?: string;
  depthTicks: ChartTick[];
  timeTicks: ChartTick[];
  maxDepthM: number;
  durationS: number;
  sampleCount: number;
};

const DEFAULT_BOX: ChartBox = {
  width: 900,
  height: 280,
  padding: { top: 14, right: 52, bottom: 30, left: 48 },
};

export function buildProfileChart(
  series: ProfileSeries,
  box: Partial<ChartBox> = {},
): ProfileChart | undefined {
  const { width, height, padding } = { ...DEFAULT_BOX, ...box };
  const timeS = series.timeS ?? [];
  const depthM = series.depthM ?? [];

  // A single point is not a curve, and mismatched channels mean the decode
  // went wrong — better to draw nothing than to draw something misleading.
  if (timeS.length < 2 || depthM.length !== timeS.length) return undefined;

  const start = timeS[0] as number;
  const end = timeS[timeS.length - 1] as number;
  const duration = end - start;
  if (duration <= 0) return undefined;

  const maxDepth = Math.max(...depthM);
  // Round the axis out to a whole number so gridlines land where a person
  // would put them. The floor keeps a snorkel from filling the whole chart.
  const depthCeiling = Math.max(5, Math.ceil(maxDepth / 5) * 5);

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const x = (t: number): number => padding.left + ((t - start) / duration) * plotWidth;
  // Depth increases downward, the way every dive computer draws it. Inverted,
  // the shape is misread at a glance by exactly the people who read these.
  const y = (d: number): number => padding.top + (d / depthCeiling) * plotHeight;

  const round = (n: number): string => n.toFixed(1);
  const path = timeS
    .map((t, i) => `${i === 0 ? 'M' : 'L'}${round(x(t))},${round(y(depthM[i] as number))}`)
    .join(' ');
  const area = `${path} L${round(x(end))},${round(y(0))} L${round(x(start))},${round(y(0))} Z`;

  const tempC = series.tempC;
  const temperaturePath =
    tempC && tempC.length === timeS.length && tempC.some((v) => Number.isFinite(v))
      ? buildTemperature(tempC, timeS, x, height, padding, plotHeight)
      : undefined;

  return {
    path,
    area,
    ...(temperaturePath === undefined ? {} : { temperaturePath }),
    depthTicks: Array.from({ length: 5 }, (_, i) => {
      const value = (depthCeiling / 4) * i;
      return { value, y: y(value), label: `${value.toFixed(0)}m` };
    }),
    timeTicks: Array.from({ length: 5 }, (_, i) => {
      const value = start + (duration / 4) * i;
      return { value, x: x(value), label: `${Math.round((value - start) / 60)}min` };
    }),
    maxDepthM: maxDepth,
    durationS: duration,
    sampleCount: timeS.length,
  };
}

/**
 * Temperature shares the box but not the scale — it is a shape, not a reading.
 * Confined to the lower third so it cannot be mistaken for the depth line.
 */
function buildTemperature(
  tempC: readonly number[],
  timeS: readonly number[],
  x: (t: number) => number,
  height: number,
  padding: ChartBox['padding'],
  plotHeight: number,
): string {
  const finite = tempC.filter((v) => Number.isFinite(v));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  // A dive at one temperature throughout is a flat line, not a divide by zero.
  const span = max - min || 1;

  return timeS
    .map((t, i) => {
      const value = tempC[i] as number;
      const normalized = Number.isFinite(value) ? (value - min) / span : 0;
      const y = height - padding.bottom - normalized * plotHeight * 0.3;
      return `${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export type ProfileRow = {
  timeS: number;
  depthM: number;
  tempC?: number;
  /** The deepest sample of the dive, which is forced into every table. */
  isDeepest: boolean;
};

/**
 * The chart as a table.
 *
 * A depth profile drawn as an SVG path is a picture of a dive, not a record of
 * one — a screen reader is handed a single alt string and everything the curve
 * actually says is gone. docs/08-clients.md requires an equivalent, and this
 * builds it.
 *
 * Not every sample: a 50-minute dive is two hundred of them, and a table that
 * long is a different way of hiding the same information. Evenly spaced rows
 * describe the shape, and the deepest sample is forced in on top of them —
 * because it is the one number a diver looks for, and even spacing lands on it
 * only by accident.
 */
export function buildProfileTable(series: ProfileSeries, rows = 12): ProfileRow[] {
  const timeS = series.timeS ?? [];
  const depthM = series.depthM ?? [];
  if (timeS.length === 0 || depthM.length !== timeS.length) return [];

  const tempC = series.tempC?.length === timeS.length ? series.tempC : undefined;
  const deepest = depthM.reduce((best, d, i) => (d > (depthM[best] as number) ? i : best), 0);

  // A Set so the forced deepest sample cannot appear twice when the even
  // spacing happens to land on it.
  const chosen = new Set<number>([0, timeS.length - 1, deepest]);
  const step = Math.max(1, Math.floor((timeS.length - 1) / Math.max(1, rows - 1)));
  for (let i = 0; i < timeS.length; i += step) chosen.add(i);

  const start = timeS[0] as number;
  return [...chosen]
    .sort((a, b) => a - b)
    .map((i) => {
      const temperature = tempC?.[i];
      return {
        timeS: (timeS[i] as number) - start,
        depthM: depthM[i] as number,
        ...(temperature !== undefined && Number.isFinite(temperature)
          ? { tempC: temperature }
          : {}),
        isDeepest: i === deepest,
      };
    });
}

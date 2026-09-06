/**
 * Aggregations over a logbook.
 *
 * Pure, so the awkward cases have tests rather than screenshots: a diver with
 * one dive, a diver with a gap of nine years, a dive with no depth recorded.
 * Every one of those exists in the sample data.
 *
 * Depths stay in metres here. Bucketing is the one place that cannot be left
 * to the display layer — a histogram bucketed at 5 m and then relabelled in
 * feet gives boundaries of 16.4 and 32.8 ft, which is nobody's mental model —
 * so the caller passes the bucket width it wants in metres.
 */

export type StatDive = {
  startTimeLocal: Date;
  durationS: number | null;
  maxDepthM: number | null;
};

export type YearRow = { year: number; dives: number; bottomTimeS: number };

/**
 * Dives per calendar year, including the years with none.
 *
 * The gaps are the point. This logbook has dives in 2012, 2013, 2021, 2022 and
 * 2026; a chart that omits the empty years draws five equal bars and hides the
 * eight-year break that is the most obvious fact about it.
 */
export function divesByYear(dives: readonly StatDive[]): YearRow[] {
  if (dives.length === 0) return [];

  const counts = new Map<number, { dives: number; bottomTimeS: number }>();
  for (const dive of dives) {
    const year = dive.startTimeLocal.getUTCFullYear();
    const row = counts.get(year) ?? { dives: 0, bottomTimeS: 0 };
    row.dives += 1;
    row.bottomTimeS += dive.durationS ?? 0;
    counts.set(year, row);
  }

  const years = [...counts.keys()];
  const first = Math.min(...years);
  const last = Math.max(...years);

  return Array.from({ length: last - first + 1 }, (_, i) => {
    const year = first + i;
    const row = counts.get(year);
    return { year, dives: row?.dives ?? 0, bottomTimeS: row?.bottomTimeS ?? 0 };
  });
}

export type Bucket = { fromM: number; toM: number; dives: number };

/**
 * How deep this diver actually goes.
 *
 * Dives with no recorded depth are left out rather than counted as zero: an
 * old paper-logbook entry with no depth is not a surface swim, and putting it
 * in the shallowest bucket would say it was.
 */
export function depthHistogram(dives: readonly StatDive[], bucketM = 5): Bucket[] {
  const depths = dives.map((d) => d.maxDepthM).filter((d): d is number => d !== null && d >= 0);
  if (depths.length === 0 || bucketM <= 0) return [];

  const top = Math.max(...depths);
  const count = Math.floor(top / bucketM) + 1;

  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
    fromM: i * bucketM,
    toM: (i + 1) * bucketM,
    dives: 0,
  }));
  for (const depth of depths) {
    const index = Math.min(Math.floor(depth / bucketM), count - 1);
    (buckets[index] as Bucket).dives += 1;
  }
  return buckets;
}

export type MonthRow = { month: number; name: string; dives: number };

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** When in the year this diver dives, across all years. Always twelve rows. */
export function divesByMonth(dives: readonly StatDive[]): MonthRow[] {
  const counts = new Array<number>(12).fill(0);
  for (const dive of dives) {
    const month = dive.startTimeLocal.getUTCMonth();
    counts[month] = (counts[month] ?? 0) + 1;
  }
  return counts.map((dives_, i) => ({ month: i + 1, name: MONTHS[i] as string, dives: dives_ }));
}

export type Milestone = { at: number; remaining: number };

/**
 * The next round number worth noticing.
 *
 * Divers count in fifties and hundreds, and the gap between them widens as the
 * logbook grows: dive 50 is an event, dive 1,150 is not. Someone who has just
 * passed one is given the next rather than being told they are zero away from
 * the one behind them.
 */
export function nextMilestone(diveCount: number): Milestone | undefined {
  if (diveCount < 0) return undefined;
  const step = diveCount < 100 ? 25 : diveCount < 500 ? 50 : 100;
  const at = (Math.floor(diveCount / step) + 1) * step;
  return { at, remaining: at - diveCount };
}

export type Streak = { days: number; from: Date; to: Date };

/**
 * The longest run of consecutive days with a dive in it.
 *
 * A liveaboard week or a course weekend, which is the shape most logbooks have
 * and which a per-year count flattens away entirely.
 */
export function longestStreak(dives: readonly StatDive[]): Streak | undefined {
  if (dives.length === 0) return undefined;

  // Local dates, deduplicated: three dives on one day are one day.
  const days = [...new Set(dives.map((d) => d.startTimeLocal.toISOString().slice(0, 10)))].sort();

  let best = { days: 1, from: days[0] as string, to: days[0] as string };
  let runStart = days[0] as string;
  let runLength = 1;

  for (let i = 1; i < days.length; i += 1) {
    const previous = Date.parse(`${days[i - 1] as string}T00:00:00Z`);
    const current = Date.parse(`${days[i] as string}T00:00:00Z`);
    const consecutive = current - previous === 86_400_000;

    runLength = consecutive ? runLength + 1 : 1;
    if (!consecutive) runStart = days[i] as string;
    if (runLength > best.days) best = { days: runLength, from: runStart, to: days[i] as string };
  }

  return {
    days: best.days,
    from: new Date(`${best.from}T00:00:00Z`),
    to: new Date(`${best.to}T00:00:00Z`),
  };
}

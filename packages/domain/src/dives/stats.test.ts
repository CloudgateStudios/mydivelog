import { describe, expect, it } from 'vitest';
import {
  depthHistogram,
  divesByMonth,
  divesByYear,
  longestStreak,
  nextMilestone,
  type StatDive,
} from './stats.ts';

const dive = (iso: string, maxDepthM: number | null = 20, durationS: number | null = 2700) =>
  ({ startTimeLocal: new Date(iso), maxDepthM, durationS }) as StatDive;

describe('divesByYear', () => {
  it('includes the years with no dives in them', () => {
    // The gap is the most obvious fact about this logbook — dives in 2012 and
    // then nothing until 2021. Omitting the empty years draws equal bars and
    // hides it.
    const years = divesByYear([dive('2012-06-02T09:00:00Z'), dive('2015-06-02T09:00:00Z')]);
    expect(years.map((y) => y.year)).toEqual([2012, 2013, 2014, 2015]);
    expect(years.map((y) => y.dives)).toEqual([1, 0, 0, 1]);
  });

  it('sums bottom time, treating an unrecorded duration as none rather than as an error', () => {
    const years = divesByYear([
      dive('2012-06-02T09:00:00Z', 20, 2700),
      dive('2012-06-03T09:00:00Z', 20, null),
    ]);
    expect(years[0]).toEqual({ year: 2012, dives: 2, bottomTimeS: 2700 });
  });

  it('has nothing to say about an empty logbook', () => {
    expect(divesByYear([])).toEqual([]);
  });
});

describe('depthHistogram', () => {
  it('buckets by the width it is given', () => {
    const buckets = depthHistogram(
      [dive('2026-03-06T09:00:00Z', 4), dive('2026-03-06T11:00:00Z', 12)],
      5,
    );
    expect(buckets).toEqual([
      { fromM: 0, toM: 5, dives: 1 },
      { fromM: 5, toM: 10, dives: 0 },
      { fromM: 10, toM: 15, dives: 1 },
    ]);
  });

  it('leaves out a dive with no recorded depth rather than calling it zero', () => {
    // An old paper-logbook entry with no depth is not a surface swim, and the
    // shallowest bucket would say it was.
    const buckets = depthHistogram(
      [dive('2026-03-06T09:00:00Z', null), dive('2026-03-06T11:00:00Z', 12)],
      5,
    );
    expect(buckets.reduce((n, b) => n + b.dives, 0)).toBe(1);
  });

  it('puts a dive exactly on a boundary in the bucket that starts there', () => {
    expect(depthHistogram([dive('2026-03-06T09:00:00Z', 10)], 5).map((b) => b.dives)).toEqual([
      0, 0, 1,
    ]);
  });

  it('keeps the deepest dive inside the last bucket', () => {
    // Math.floor(30 / 5) is 6, which is one past the end of a six-bucket array.
    const buckets = depthHistogram([dive('2026-03-06T09:00:00Z', 30)], 5);
    expect(buckets.at(-1)?.dives).toBe(1);
    expect(buckets.reduce((n, b) => n + b.dives, 0)).toBe(1);
  });

  it('refuses a bucket width of zero instead of allocating forever', () => {
    expect(depthHistogram([dive('2026-03-06T09:00:00Z', 30)], 0)).toEqual([]);
  });
});

describe('divesByMonth', () => {
  it('always returns twelve months, so the shape of a year is visible', () => {
    const months = divesByMonth([dive('2026-03-06T09:00:00Z'), dive('2022-03-30T09:00:00Z')]);
    expect(months).toHaveLength(12);
    expect(months[2]).toEqual({ month: 3, name: 'March', dives: 2 });
    expect(months[0]?.dives).toBe(0);
  });
});

describe('nextMilestone', () => {
  it('counts in the intervals divers actually count in', () => {
    expect(nextMilestone(0)?.at).toBe(25);
    expect(nextMilestone(24)).toEqual({ at: 25, remaining: 1 });
    expect(nextMilestone(120)?.at).toBe(150);
    expect(nextMilestone(640)?.at).toBe(700);
  });

  it('gives the next one to somebody standing on a milestone', () => {
    // Dive 100 exactly. "0 away from 100" is not a thing worth telling anyone.
    expect(nextMilestone(100)).toEqual({ at: 150, remaining: 50 });
  });
});

describe('longestStreak', () => {
  it('finds the liveaboard week', () => {
    const streak = longestStreak([
      dive('2026-03-02T09:00:00Z'),
      dive('2026-03-03T09:00:00Z'),
      dive('2026-03-04T09:00:00Z'),
      dive('2026-03-09T09:00:00Z'),
    ]);
    expect(streak?.days).toBe(3);
    expect(streak?.from.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(streak?.to.toISOString().slice(0, 10)).toBe('2026-03-04');
  });

  it('counts three dives in one day as one day', () => {
    expect(
      longestStreak([
        dive('2026-03-02T09:00:00Z'),
        dive('2026-03-02T12:00:00Z'),
        dive('2026-03-02T15:00:00Z'),
      ])?.days,
    ).toBe(1);
  });

  it('crosses a month boundary', () => {
    // 31 March to 1 April is consecutive; comparing day-of-month is not.
    expect(longestStreak([dive('2026-03-31T09:00:00Z'), dive('2026-04-01T09:00:00Z')])?.days).toBe(
      2,
    );
  });

  it('has nothing to report for an empty logbook', () => {
    expect(longestStreak([])).toBeUndefined();
  });
});

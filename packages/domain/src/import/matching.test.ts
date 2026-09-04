import { describe, expect, it } from 'vitest';
import {
  assignBatch,
  AUTO_MERGE_THRESHOLD,
  compareTimes,
  matchObservation,
  scoreMatch,
  selectCandidates,
  type MatchCandidate,
} from './matching.ts';
import { emptyObservation, type DiveObservation } from './observation.ts';

/** The Bonaire dive that appears in both seed files. */
const BONAIRE = { lat: 12.1, lon: -68.29 };

const observation = (over: Partial<DiveObservation> = {}): DiveObservation => ({
  ...emptyObservation('spreadsheet', {}),
  startTime: { local: new Date('2026-03-06T19:07:00Z'), raw: '' },
  ...over,
});

const existing = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: 'dive-1',
  startTimeLocal: new Date('2026-03-06T19:07:42Z'),
  startTimeUtc: new Date('2026-03-06T23:07:42Z'),
  ...over,
});

describe('compareTimes', () => {
  it('prefers local time, which is the only basis a spreadsheet has', () => {
    // Comparing UTC would mean inventing a zone for the spreadsheet, and
    // inventing it from the server's zone is how the same pair of files match
    // in Chicago and fail in UTC.
    const c = compareTimes(
      { local: new Date('2026-03-06T19:07:00Z') },
      {
        startTimeLocal: new Date('2026-03-06T19:07:42Z'),
        startTimeUtc: new Date('2026-03-06T23:07:42Z'),
      },
    );
    expect(c.basis).toBe('local');
    expect(c.deltaMs).toBe(42_000);
  });

  it('falls back to UTC when only that is shared', () => {
    const c = compareTimes(
      { utc: new Date('2026-03-06T23:07:00Z') },
      { startTimeUtc: new Date('2026-03-06T23:07:42Z') },
    );
    expect(c.basis).toBe('utc');
  });

  it('reports no basis when the two share nothing', () => {
    expect(compareTimes({ utc: new Date() }, { startTimeLocal: new Date() }).basis).toBe('none');
  });

  it('recognises the same calendar day', () => {
    const c = compareTimes(
      { local: new Date('2026-03-06T08:00:00Z') },
      { startTimeLocal: new Date('2026-03-06T19:00:00Z') },
    );
    expect(c.sameLocalDate).toBe(true);
  });
});

describe('scoreMatch', () => {
  it('is certain when the source id is already on the dive', () => {
    // What makes importing the same file twice a no-op.
    const m = scoreMatch(
      observation({ sourceRef: 'dive_69ab' }),
      existing({ sourceRefs: ['dive_69ab'] }),
    );
    expect(m.score).toBe(1);
    expect(m.reasons[0]?.signal).toBe('sourceRef');
  });

  it('scores the worked example high enough to merge', () => {
    // Spreadsheet row #195 against the UDDF dive: 46 ft vs 14.099 m, EAN 32
    // vs sensed 0.33, same site, times 42 s apart.
    const m = scoreMatch(
      observation({
        maxDepthM: 14.0208, // 46 ft
        durationS: 2760,
        site: { name: 'Angel City' },
        gases: [{ o2Fraction: 0.32 }],
      }),
      existing({ maxDepthM: 14.099043, durationS: 2776, site: BONAIRE }),
    );
    expect(m.score).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });

  it('explains every contribution', () => {
    // A merge a diver cannot understand is one they will not trust.
    const m = scoreMatch(
      observation({ maxDepthM: 14.02, durationS: 2760 }),
      existing({ maxDepthM: 14.099, durationS: 2776 }),
    );
    expect(m.reasons.length).toBeGreaterThan(1);
    expect(m.reasons.every((r) => r.detail.length > 0)).toBe(true);
  });

  it('tolerates a human rounding a depth', () => {
    // 46 ft against 14.099 m is 0.08 m apart. A 5% band covers it.
    const m = scoreMatch(observation({ maxDepthM: 14.0208 }), existing({ maxDepthM: 14.099043 }));
    expect(m.reasons.some((r) => r.signal === 'maxDepth')).toBe(true);
  });

  it('does not credit depths that genuinely disagree', () => {
    const m = scoreMatch(observation({ maxDepthM: 30 }), existing({ maxDepthM: 14 }));
    expect(m.reasons.some((r) => r.signal === 'maxDepth')).toBe(false);
  });

  it('credits sites within 500 m', () => {
    const m = scoreMatch(
      observation({ site: { lat: 12.1005, lon: -68.29 } }),
      existing({ site: BONAIRE }),
    );
    expect(m.reasons.some((r) => r.signal === 'site')).toBe(true);
  });

  it('falls back to site names when only one side has coordinates', () => {
    const m = scoreMatch(
      observation({ site: { name: 'Angel City' } }),
      existing({ site: { name: 'Angel City Reef' } }),
    );
    expect(m.reasons.some((r) => r.signal === 'site')).toBe(true);
  });

  it('scores nothing for a dive on another day', () => {
    const m = scoreMatch(
      observation({ startTime: { local: new Date('2024-01-01T10:00:00Z'), raw: '' } }),
      existing(),
    );
    expect(m.score).toBe(0);
  });
});

describe('matchObservation', () => {
  it('merges a strong match', () => {
    const out = matchObservation(
      observation({ maxDepthM: 14.02, durationS: 2760, site: { name: 'Angel City' } }),
      [existing({ maxDepthM: 14.099, durationS: 2776, site: { name: 'Angel City' } })],
    );
    expect(out.decision).toBe('merge');
  });

  it('creates when nothing is close', () => {
    const out = matchObservation(observation(), [
      existing({ startTimeLocal: new Date('2020-01-01T10:00:00Z'), startTimeUtc: undefined }),
    ]);
    expect(out.decision).toBe('create');
  });

  it('never merges on date alone', () => {
    // Five dives in one day in Bonaire share a date, similar depths and
    // similar durations. Time of day is what separates them.
    const out = matchObservation(
      observation({ startTime: { local: new Date('2026-03-06T06:00:00Z'), raw: '' } }),
      [existing({ startTimeLocal: new Date('2026-03-06T19:07:42Z') })],
    );
    expect(out.decision).not.toBe('merge');
  });

  it('sends a suspect offset to review even on a perfect score', () => {
    // Raising the threshold instead does nothing: the weights sum past 1 and
    // the score clamps, so a dive agreeing on everything scores exactly 1.0
    // and clears any bar below it. The strongest matches — the ones most worth
    // stopping — were the ones a raised threshold could not catch.
    const strong = {
      maxDepthM: 14.02,
      durationS: 2760,
      site: { name: 'Angel City' },
      gases: [{ o2Fraction: 0.33 }],
    };
    const candidate = existing({
      maxDepthM: 14.099,
      durationS: 2776,
      site: { name: 'Angel City' },
      gases: [{ o2Fraction: 0.33 }],
    });

    expect(matchObservation(observation(strong), [candidate]).decision).toBe('merge');

    const suspect = observation({
      ...strong,
      startTime: { local: new Date('2026-03-06T19:07:00Z'), raw: '', offsetSuspect: true },
    });
    const out = matchObservation(suspect, [candidate]);
    expect(out.best?.score).toBe(1);
    expect(out.decision).toBe('ambiguous');
    expect(out.note).toContain('time of day');
  });

  it('still merges an exact re-import despite a suspect offset', () => {
    // The source id is not a judgement call, so nothing about the clock
    // changes it.
    const out = matchObservation(
      observation({
        sourceRef: 'dive_69ab',
        startTime: { local: new Date('2026-03-06T19:07:00Z'), raw: '', offsetSuspect: true },
      }),
      [existing({ sourceRefs: ['dive_69ab'] })],
    );
    expect(out.decision).toBe('merge');
  });

  it('asks when two existing dives match about equally well', () => {
    const shared = { maxDepthM: 14.099, durationS: 2776, site: { name: 'Angel City' } };
    const out = matchObservation(
      observation({ maxDepthM: 14.02, durationS: 2760, site: { name: 'Angel City' } }),
      [existing({ id: 'a', ...shared }), existing({ id: 'b', ...shared })],
    );
    expect(out.decision).toBe('ambiguous');
    expect(out.note).toContain('equally well');
  });
});

describe('selectCandidates', () => {
  it('reaches six hours out, because the incoming zone may be wrong', () => {
    const near = existing({ id: 'near', startTimeLocal: new Date('2026-03-06T23:00:00Z') });
    const far = existing({ id: 'far', startTimeLocal: new Date('2026-03-07T05:00:00Z') });
    const ids = selectCandidates(observation(), [near, far]).map((c) => c.id);
    expect(ids).toEqual(['near']);
  });

  it('returns nothing when times cannot be compared at all', () => {
    expect(selectCandidates(observation({ startTime: { raw: '' } }), [existing()])).toEqual([]);
  });
});

describe('assignBatch', () => {
  const target = existing({ maxDepthM: 14.099, durationS: 2776, site: { name: 'Angel City' } });

  it('lets one dive receive only one observation', () => {
    // Two rows claiming one dive means the file has duplicates or its times
    // are wrong. Neither is a reason to silently create a duplicate.
    const rows = [
      observation({ maxDepthM: 14.02, durationS: 2760, site: { name: 'Angel City' } }),
      observation({ maxDepthM: 14.02, durationS: 2760, site: { name: 'Angel City' } }),
    ];
    const decisions = assignBatch(rows, [target]).map((a) => a.outcome.decision);
    expect(decisions.filter((d) => d === 'merge')).toHaveLength(1);
    expect(decisions.filter((d) => d === 'ambiguous')).toHaveLength(1);
  });

  it('gives the dive to the stronger claim, not the earlier row', () => {
    const weak = observation({ site: { name: 'Angel City' } });
    const strong = observation({
      maxDepthM: 14.099,
      durationS: 2776,
      site: { name: 'Angel City' },
      gases: [{ o2Fraction: 0.33 }],
    });
    const assignments = assignBatch([weak, strong], [{ ...target, gases: [{ o2Fraction: 0.33 }] }]);
    expect(assignments[1]?.outcome.decision).toBe('merge');
    expect(assignments[0]?.outcome.decision).toBe('ambiguous');
  });

  it('explains which row won', () => {
    const rows = [
      observation({
        maxDepthM: 14.099,
        durationS: 2776,
        site: { name: 'Angel City' },
        gases: [{ o2Fraction: 0.33 }],
      }),
      observation({ maxDepthM: 14.02, durationS: 2760, site: { name: 'Angel City' } }),
    ];
    const loser = assignBatch(rows, [{ ...target, gases: [{ o2Fraction: 0.33 }] }])[1];
    expect(loser?.outcome.note).toContain('Row 1');
  });

  it('returns rows in their original order', () => {
    const rows = [observation(), observation({ maxDepthM: 14.02 }), observation()];
    expect(assignBatch(rows, [target]).map((a) => a.observationIndex)).toEqual([0, 1, 2]);
  });

  it('leaves non-merges alone', () => {
    const rows = [observation({ startTime: { local: new Date('2019-01-01T10:00:00Z'), raw: '' } })];
    expect(assignBatch(rows, [target])[0]?.outcome.decision).toBe('create');
  });
});

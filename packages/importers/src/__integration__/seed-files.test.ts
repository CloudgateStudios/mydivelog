import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assignBatch,
  type DiveObservation,
  type MatchCandidate,
  type TzResolver,
} from '@mydivelog/domain';
import { parseCsv, parseTabular, parseUddf } from '../index.ts';

/**
 * Both real files, parsed and matched against each other.
 *
 * This is the closest thing to the phase's acceptance gate that exists before
 * merge lands: the two files describe the same physical dives in incompatible
 * shapes, and a naive importer produces one row per record with every
 * overlapping dive duplicated. Here the overlap has to resolve to exactly one
 * dive each.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url)), 'utf8');

/** Every site in the fixture is Caribbean; all of them are -04:00. */
const atlantic: TzResolver = () => -240;

/** Shapes a parsed observation as though it were already in the logbook. */
const asExisting = (o: DiveObservation, index: number): MatchCandidate => ({
  id: `uddf-${index}`,
  ...(o.startTime.utc ? { startTimeUtc: o.startTime.utc } : {}),
  ...(o.startTime.local ? { startTimeLocal: o.startTime.local } : {}),
  ...(o.durationS === undefined ? {} : { durationS: o.durationS }),
  ...(o.maxDepthM === undefined ? {} : { maxDepthM: o.maxDepthM }),
  ...(o.site ? { site: o.site } : {}),
  ...(o.gases ? { gases: o.gases } : {}),
  sourceRefs: o.sourceRef ? [o.sourceRef] : [],
});

const uddf = parseUddf(fixture('uddf-sample.uddf'), { resolveTz: atlantic });
const table = parseCsv(fixture('spreadsheet-sample.csv'));
const sheet = parseTabular(table.headers, table.rows);
const existing = uddf.observations.map(asExisting);

describe('the two seed files, matched against each other', () => {
  const assignments = assignBatch(sheet.observations, existing);
  const decisions = assignments.map((a) => a.outcome.decision);

  it('parses both files completely', () => {
    expect(uddf.observations).toHaveLength(6);
    expect(sheet.observations).toHaveLength(24);
  });

  it('matches every overlapping dive exactly once', () => {
    // The overlap window is 2026-03-05 and 2026-03-06, six dives deep.
    expect(decisions.filter((d) => d === 'merge')).toHaveLength(6);
  });

  it('produces no duplicates and no unresolved rows', () => {
    // 24 spreadsheet rows against 6 computer dives should give 24 dives, not
    // 30. A naive importer gives 30 and the diver leaves on day one.
    expect(decisions.filter((d) => d === 'create')).toHaveLength(18);
    expect(decisions.filter((d) => d === 'ambiguous')).toHaveLength(0);
    const total = new Set(
      assignments.map((a, i) =>
        a.outcome.decision === 'merge' ? a.outcome.best?.candidateId : `new-${i}`,
      ),
    );
    expect(total.size).toBe(24);
  });

  it('pairs each row with the right dive, not merely with some dive', () => {
    // The UDDF lists dives newest first and the sheet oldest first. Matching
    // the counts while pairing them backwards would pass a weaker assertion.
    const merged = assignments
      .filter((a) => a.outcome.decision === 'merge')
      .map((a) => [a.observationIndex, a.outcome.best?.candidateId] as const);

    expect(merged).toEqual([
      [18, 'uddf-5'],
      [19, 'uddf-4'],
      [20, 'uddf-3'],
      [21, 'uddf-2'],
      [22, 'uddf-1'],
      [23, 'uddf-0'],
    ]);
  });

  it('gives each merge a comfortable margin over the threshold', () => {
    // Not a vanity check. These sat at exactly 0.80 — the threshold itself —
    // until the gas signal was fixed, because `Math.abs(0.32 - 0.33)` is
    // 0.010000000000000009 and never cleared a bare 0.01 tolerance. Every real
    // gas agreement scored zero and nothing looked wrong.
    for (const a of assignments) {
      if (a.outcome.decision !== 'merge') continue;
      expect(a.outcome.best?.score).toBeGreaterThan(0.8);
    }
  });

  it('assigns no existing dive to two rows', () => {
    const claimed = assignments
      .filter((a) => a.outcome.decision === 'merge')
      .map((a) => a.outcome.best?.candidateId);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('explains each merge in terms a diver can check', () => {
    const first = assignments.find((a) => a.outcome.decision === 'merge');
    const signals = first?.outcome.best?.reasons.map((r) => r.signal) ?? [];
    expect(signals).toContain('startTime');
    expect(signals).toContain('maxDepth');
    expect(signals).toContain('duration');
  });

  it('does not credit a site match neither file can support', () => {
    // The sheet has `Angel City` and no coordinates; the computer has
    // coordinates and no name. There is nothing to compare — and producing a
    // site that is both named and located is precisely what the merge is for.
    const first = assignments.find((a) => a.outcome.decision === 'merge');
    expect(first?.outcome.best?.reasons.map((r) => r.signal)).not.toContain('site');
  });
});

describe('re-importing the same file', () => {
  it('changes nothing, by source id alone', () => {
    // Idempotence does not depend on scoring: the ids are already on the dives.
    const assignments = assignBatch(uddf.observations, existing);
    expect(assignments.every((a) => a.outcome.decision === 'merge')).toBe(true);
    expect(assignments.every((a) => a.outcome.best?.reasons[0]?.signal === 'sourceRef')).toBe(true);
    expect(assignments.map((a) => a.outcome.best?.candidateId)).toEqual([
      'uddf-0',
      'uddf-1',
      'uddf-2',
      'uddf-3',
      'uddf-4',
      'uddf-5',
    ]);
  });
});

describe('the spreadsheet imported into an empty logbook', () => {
  it('creates every row and merges nothing', () => {
    const assignments = assignBatch(sheet.observations, []);
    expect(assignments.every((a) => a.outcome.decision === 'create')).toBe(true);
  });
});

describe('without a timezone resolver', () => {
  it('sends every overlapping dive to review rather than guessing', () => {
    // The offsets stay unrepaired and flagged, so time of day is unreliable —
    // and time of day is what separates five dives in one day.
    const unrepaired = parseUddf(fixture('uddf-sample.uddf'));
    const assignments = assignBatch(sheet.observations, unrepaired.observations.map(asExisting));
    expect(assignments.some((a) => a.outcome.decision === 'merge')).toBe(true);

    const reverse = assignBatch(unrepaired.observations, existing);
    expect(reverse.every((a) => a.outcome.decision !== 'create')).toBe(true);
  });
});

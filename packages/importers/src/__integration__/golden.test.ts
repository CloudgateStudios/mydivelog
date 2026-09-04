import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../../../fixtures/scripts/snapshot.mjs';
import { parseUddf } from '../uddf/index.ts';
import { runPipeline } from '../pipeline.ts';

/**
 * The golden fixture — the single highest-value test in the project.
 *
 * Both real files, merged, verified by hand once and asserted against on every
 * change to the import engine after that. If this drifts, the engine now
 * merges someone's dive history differently, and that has to be read and
 * understood rather than regenerated away.
 *
 * The assertions below the snapshot comparison are deliberate duplication:
 * a snapshot tells you *that* something changed, and these say *what would be
 * wrong* if it did.
 */

const expected = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../fixtures/expected/merged.json', import.meta.url)),
    'utf8',
  ),
) as ReturnType<typeof buildSnapshot>;

const actual = buildSnapshot();

const uddfObservations = parseUddf(
  readFileSync(
    fileURLToPath(new URL('../../../../fixtures/uddf-sample.uddf', import.meta.url)),
    'utf8',
  ),
  { resolveTz: () => -240 },
).observations;

describe('the golden merge', () => {
  it('matches the hand-verified snapshot exactly', () => {
    expect(actual).toEqual(expected);
  });
});

describe('what the snapshot is asserting', () => {
  const { summary, dives } = actual;

  it('produces one history with zero duplicate dives', () => {
    // 24 spreadsheet rows and 6 computer dives. A naive importer gives 30 and
    // the diver abandons the product on day one.
    expect(summary.dives).toBe(24);
    expect(summary.mergedInto).toBe(6);
  });

  it('gives every overlapping dive both sources', () => {
    expect(summary.withTwoSources).toBe(6);
    const both = dives.filter((d) => d.sources.length > 1);
    expect(both.every((d) => d.sources.includes('spreadsheet') && d.sources.includes('uddf'))).toBe(
      true,
    );
  });

  it('gives every overlapping dive a depth profile', () => {
    expect(summary.withProfile).toBe(6);
    const both = dives.filter((d) => d.sources.length > 1);
    expect(both.every((d) => d.values.profile !== undefined)).toBe(true);
  });

  it('needs no human intervention on this pair of files', () => {
    expect(summary.needsReview).toBe(0);
    expect(summary.contested).toBe(0);
  });

  it('corrects every malformed offset to -04:00', () => {
    // The `-00:04` bug. Left alone, every one of these dives sits four hours
    // from where it belongs.
    const withOffset = dives.filter((d) => d.values.tzOffsetMinutes !== undefined);
    expect(withOffset).toHaveLength(6);
    expect(withOffset.every((d) => d.values.tzOffsetMinutes === -240)).toBe(true);
  });

  it('keeps the site name from the spreadsheet and the coordinates from the watch', () => {
    // Neither file can do this alone, and it is the entire value proposition.
    const bonaire = dives.find((d) => d.values['site.name'] === 'Angel City');
    expect(bonaire?.sources).toEqual(['spreadsheet', 'uddf']);
    expect(bonaire?.values['site.lat']).toBeDefined();
    expect(bonaire?.values['site.lon']).toBeDefined();
  });

  it('takes the instrument’s depth over the diver’s rounding', () => {
    const bonaire = dives.find((d) => d.values['site.name'] === 'Angel City');
    // 14.099043 m from the computer, not 14.0208 m (46 ft rounded by hand).
    expect(bonaire?.values.maxDepthM).toBe(14.099043);
  });

  it('takes the sensed gas over the remembered one', () => {
    const bonaire = dives.find((d) => d.values['site.name'] === 'Angel City');
    expect(bonaire?.values.gases).toEqual([{ o2Fraction: 0.33, label: 'nitrox' }]);
  });

  it('carries a real weight on every dive', () => {
    // Note what this does *not* prove. Removing the leadquantity sentinel
    // leaves this passing, because weight is a `configured` field where the
    // spreadsheet already outranks the watch — precedence saves it here, not
    // the sentinel. The case where the sentinel is load-bearing is a dive the
    // watch alone knows about; that is asserted below.
    const weights = dives.map((d) => d.values.weightKg).filter((w) => w !== undefined);
    expect(weights).toHaveLength(24);
    expect(weights.every((w) => (w as number) > 0)).toBe(true);
  });

  it('does not split a site name on the comma inside it', () => {
    // `1,000 Steps` is one place. Splitting it invents a site called
    // `000 Steps` and puts real dives at it.
    const names = dives.map((d) => d.values['site.name']);
    expect(names).toContain('1,000 Steps');
    expect(names.some((n) => typeof n === 'string' && /^0{3}\b/.test(n))).toBe(false);
  });

  it('leaves N/A site names absent rather than importing them', () => {
    const names = dives.map((d) => d.values['site.name']);
    expect(names).not.toContain('N/A');
    // And the rows that had N/A still exist as dives.
    expect(names.filter((n) => n === undefined).length).toBeGreaterThan(0);
  });

  it('never keeps an opaque site id as a name', () => {
    for (const dive of dives) {
      const name = dive.values['site.name'];
      if (typeof name === 'string') expect(name).not.toMatch(/^site_/);
    }
  });

  it('orders the whole logbook by local time without gaps', () => {
    const times = dives.map((d) => String(d.values.startTimeLocal ?? ''));
    expect(times.every((t) => t !== '')).toBe(true);
    expect([...times].sort()).toEqual(times);
  });
});

describe('the computer export alone, where the sentinel is load-bearing', () => {
  // Every UDDF dive in the fixture happens to also exist in the spreadsheet,
  // so the merged result never depends on the leadquantity sentinel: the
  // diver's real weight outranks the watch's anyway. A diver whose computer
  // recorded a dive their spreadsheet missed has no such protection, and that
  // is the case worth asserting.
  const uddfOnly = runPipeline({
    batches: [{ sourceKind: 'uddf', observations: uddfObservations }],
  });

  it('imports every dive', () => {
    expect(uddfOnly.dives).toHaveLength(6);
  });

  it('records no weight at all rather than a false zero', () => {
    // Without the sentinel these would each claim 0 kg of lead, asserted by an
    // instrument, on a dive with nothing to contradict it.
    for (const dive of uddfOnly.dives) {
      expect(dive.values['weightKg']).toBeUndefined();
    }
  });

  it('records no site name rather than an opaque id', () => {
    for (const dive of uddfOnly.dives) {
      expect(dive.values['site.name']).toBeUndefined();
      expect(dive.values['site.lat']).toBeDefined();
    }
  });

  it('still repairs every offset', () => {
    expect(uddfOnly.dives.every((d) => d.values['tzOffsetMinutes'] === -240)).toBe(true);
  });
});

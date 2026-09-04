import { describe, expect, it } from 'vitest';
import {
  classOf,
  mergeDive,
  originOf,
  provenanceRows,
  resolveField,
  sameValue,
  selectedValues,
  type Contribution,
} from './merge.ts';

const RECORDED = new Date('2026-03-06T19:07:42Z');
const LATER = new Date('2026-03-07T10:00:00Z');

const from = (
  sourceKind: string,
  value: unknown,
  over: Partial<Contribution> = {},
): Contribution => ({
  sourceId: `${sourceKind}-1`,
  sourceKind,
  recordedAt: RECORDED,
  value,
  ...over,
});

describe('source origins', () => {
  it('treats a dive computer as an instrument and a workbook as a file import', () => {
    expect(originOf('uddf')).toBe('instrument');
    expect(originOf('spreadsheet')).toBe('file_import');
    expect(originOf('manual')).toBe('manual');
  });

  it('defaults an unknown format to file_import, not instrument', () => {
    // The safe default: a format nobody has classified should not be trusted
    // over the diver on their own notes.
    expect(originOf('some-new-vendor-xml')).toBe('file_import');
  });
});

describe('field classes', () => {
  it('classifies the fields the worked example turns on', () => {
    expect(classOf('maxDepthM')).toBe('measured');
    expect(classOf('site.name')).toBe('identifying');
    expect(classOf('site.lat')).toBe('geographic');
    expect(classOf('notes')).toBe('subjective');
    expect(classOf('weightKg')).toBe('configured');
  });

  it('defaults an unlisted field to measured', () => {
    expect(classOf('someNewNumber')).toBe('measured');
  });
});

describe('resolveField', () => {
  it('gives a measured field to the instrument', () => {
    // 46 ft was rounded by a person; 14.099043 m was read by the computer that
    // was there.
    const r = resolveField('maxDepthM', [from('spreadsheet', 14.0208), from('uddf', 14.099043)]);
    expect(r.value).toBe(14.099043);
    expect(r.sourceId).toBe('uddf-1');
  });

  it('gives an identifying field to the human', () => {
    // The watch calls it site_69ab7a96dce6e40c7d3abe65.
    const r = resolveField('site.name', [
      from('uddf', 'site_69ab7a96dce6e40c7d3abe65'),
      from('spreadsheet', 'Angel City'),
    ]);
    expect(r.value).toBe('Angel City');
  });

  it('gives coordinates to the instrument', () => {
    const r = resolveField('site.lat', [from('spreadsheet', 12.0), from('uddf', 12.1)]);
    expect(r.value).toBe(12.1);
  });

  it('gives a subjective field to the human', () => {
    // A watch has no opinion about visibility.
    const r = resolveField('visibilityM', [from('uddf', 30), from('spreadsheet', 12)]);
    expect(r.value).toBe(12);
  });

  it('lets a sensed reading beat a configured one', () => {
    // The diver wrote EAN 32 from memory; the computer read 33% from the
    // analyser. Configured fields go to the human unless the instrument
    // actually measured it.
    const r = resolveField('gases', [
      from('spreadsheet', [{ o2Fraction: 0.32 }]),
      from('uddf', [{ o2Fraction: 0.33 }], { sensed: true }),
    ]);
    expect(r.value).toEqual([{ o2Fraction: 0.33 }]);
    // The spreadsheet's claim is kept, not discarded.
    expect(r.provenance).toHaveLength(2);
    expect(r.provenance.find((p) => p.sourceId === 'spreadsheet-1')?.isSelected).toBe(false);
  });

  it('gives an unsensed configured field to the human', () => {
    const r = resolveField('weightKg', [from('uddf', 5), from('spreadsheet', 10.886)]);
    expect(r.value).toBe(10.886);
  });

  it('never lets a value lose to an absence', () => {
    // Rule 1, and the reason the leadquantity sentinel had to be stripped at
    // parse time: as a 0 it would arrive here as a real instrument reading and
    // beat the diver's actual weight.
    const r = resolveField('weightKg', [from('uddf', undefined), from('spreadsheet', 10.886)]);
    expect(r.value).toBe(10.886);
    expect(r.provenance).toHaveLength(1);
  });

  it('prefers the more recent record at equal standing', () => {
    const r = resolveField('maxDepthM', [
      from('uddf', 14.0, { sourceId: 'old' }),
      from('uddf', 14.5, { sourceId: 'new', recordedAt: LATER }),
    ]);
    expect(r.value).toBe(14.5);
  });

  it('flags a conflict between equals rather than picking silently', () => {
    const r = resolveField('maxDepthM', [
      from('uddf', 14.0, { sourceId: 'a' }),
      from('uddf', 22.0, { sourceId: 'b', recordedAt: LATER }),
    ]);
    expect(r.contested).toBe(true);
    expect(r.value).toBe(22.0);
    expect(r.provenance).toHaveLength(2);
  });

  it('does not flag agreement as a conflict', () => {
    const r = resolveField('maxDepthM', [
      from('uddf', 14.099, { sourceId: 'a' }),
      from('uddf', 14.099, { sourceId: 'b' }),
    ]);
    expect(r.contested).toBe(false);
  });

  it('does not flag sources of different standing as a conflict', () => {
    // The instrument and the spreadsheet disagreeing on depth is expected —
    // one rounded. Precedence settles it; there is nothing to escalate.
    const r = resolveField('maxDepthM', [from('spreadsheet', 14.02), from('uddf', 14.099)]);
    expect(r.contested).toBe(false);
  });

  it('returns nothing when no source asserted the field', () => {
    const r = resolveField('maxDepthM', [from('uddf', undefined)]);
    expect(r.value).toBeUndefined();
    expect(r.provenance).toEqual([]);
  });

  it('records every source that asserted the field', () => {
    const r = resolveField('maxDepthM', [from('spreadsheet', 14.02), from('uddf', 14.099)]);
    expect(r.provenance).toHaveLength(2);
    expect(r.provenance.filter((p) => p.isSelected)).toHaveLength(1);
  });
});

describe('notes', () => {
  it('appends rather than overwriting', () => {
    // Notes are irreplaceable and genuinely unmergeable. Losing one is not
    // recoverable from a provenance row the diver has to go looking for.
    const r = resolveField('notes', [
      from('spreadsheet', 'Saw a turtle.'),
      from('manual', 'Current picked up at the end.', { recordedAt: LATER }),
    ]);
    expect(r.value).toContain('Saw a turtle.');
    expect(r.value).toContain('Current picked up at the end.');
  });

  it('attributes each note to its source', () => {
    const r = resolveField('notes', [
      from('spreadsheet', 'Saw a turtle.'),
      from('manual', 'Current picked up.', { recordedAt: LATER }),
    ]);
    expect(r.value).toContain('— spreadsheet');
    expect(r.value).toContain('— manual');
  });

  it('keeps a lone note clean, with no attribution noise', () => {
    const r = resolveField('notes', [from('spreadsheet', 'Saw a turtle.')]);
    expect(r.value).toBe('Saw a turtle.');
  });

  it('orders notes oldest first', () => {
    const r = resolveField('notes', [
      from('manual', 'Second.', { recordedAt: LATER }),
      from('spreadsheet', 'First.'),
    ]);
    expect(r.value?.indexOf('First.')).toBeLessThan(r.value?.indexOf('Second.') ?? -1);
  });

  it('does not duplicate the same note arriving twice', () => {
    // Re-importing a file must not grow the note each time.
    const r = resolveField('notes', [
      from('spreadsheet', 'Saw a turtle.', { sourceId: 'a' }),
      from('spreadsheet', 'Saw a turtle.', { sourceId: 'b', recordedAt: LATER }),
    ]);
    expect(r.value).toBe('Saw a turtle.\n\n— spreadsheet');
  });

  it('marks every note as selected, because all of them are shown', () => {
    const r = resolveField('notes', [
      from('spreadsheet', 'One.'),
      from('manual', 'Two.', { recordedAt: LATER }),
    ]);
    expect(r.provenance.every((p) => p.isSelected)).toBe(true);
  });

  it('is never contested', () => {
    const r = resolveField('notes', [
      from('uddf', 'A.', { sourceId: 'a' }),
      from('uddf', 'B.', { sourceId: 'b' }),
    ]);
    expect(r.contested).toBe(false);
  });
});

describe('sameValue', () => {
  it('treats float noise as equal but real rounding as different', () => {
    // 14.0208 (46 ft) and 14.099043 are genuinely different readings and worth
    // showing a diver; 14.0208 and 14.02080000000001 are not.
    expect(sameValue(14.0208, 14.020800000000001)).toBe(true);
    expect(sameValue(14.0208, 14.099043)).toBe(false);
  });

  it('compares dates, arrays and objects by content', () => {
    expect(sameValue(new Date(1), new Date(1))).toBe(true);
    expect(sameValue([1, 2], [1, 2])).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue({ o2Fraction: 0.33 }, { o2Fraction: 0.33 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('mergeDive on the worked example', () => {
  // Spreadsheet row #195 and UDDF dive_69ab7a96…, the most recent dive in each
  // file and the same physical dive.
  const merged = mergeDive([
    {
      sourceId: 'sheet',
      sourceKind: 'spreadsheet',
      recordedAt: new Date('2026-03-06T00:00:00Z'),
      fields: {
        maxDepthM: 14.0208,
        'site.name': 'Angel City',
        gases: [{ o2Fraction: 0.32 }],
        weightKg: 10.886,
        notes: 'Great dive, saw an eagle ray.',
        visibilityM: 24.384,
      },
    },
    {
      sourceId: 'watch',
      sourceKind: 'uddf',
      recordedAt: new Date('2026-03-06T19:07:42Z'),
      sensedFields: ['gases'],
      fields: {
        maxDepthM: 14.099043,
        durationS: 2776,
        'site.name': 'site_69ab7a96dce6e40c7d3abe65',
        'site.lat': 12.1,
        'site.lon': -68.29,
        gases: [{ o2Fraction: 0.33 }],
        profile: { timeS: [0, 15], depthM: [0, 2.09] },
      },
    },
  ]);
  const values = selectedValues(merged);

  it('takes the instrument’s depth', () => {
    expect(values['maxDepthM']).toBe(14.099043);
  });

  it('takes the spreadsheet’s site name', () => {
    expect(values['site.name']).toBe('Angel City');
  });

  it('takes the instrument’s coordinates', () => {
    expect(values['site.lat']).toBe(12.1);
    expect(values['site.lon']).toBe(-68.29);
  });

  it('produces a site that is both named and located', () => {
    // Neither file could do this alone. This is the demo.
    expect(values['site.name']).toBe('Angel City');
    expect(values['site.lat']).toBeDefined();
  });

  it('takes the sensed gas and keeps the diver’s claim', () => {
    expect(values['gases']).toEqual([{ o2Fraction: 0.33 }]);
    const gasProvenance = merged.fields['gases']?.provenance ?? [];
    expect(gasProvenance).toHaveLength(2);
    expect(gasProvenance.find((p) => p.sourceId === 'sheet')?.value).toEqual([
      { o2Fraction: 0.32 },
    ]);
  });

  it('takes the spreadsheet’s weight, notes and visibility', () => {
    expect(values['weightKg']).toBe(10.886);
    expect(values['notes']).toContain('eagle ray');
    expect(values['visibilityM']).toBe(24.384);
  });

  it('takes fields only one source has', () => {
    expect(values['durationS']).toBe(2776);
    expect(values['profile']).toBeDefined();
  });

  it('flags nothing as contested', () => {
    // Every disagreement here is between sources of different standing, which
    // precedence settles. There is nothing for a human to arbitrate.
    expect(merged.hasContestedFields).toBe(false);
  });

  it('writes a provenance row for every assertion', () => {
    const rows = provenanceRows(merged);
    // 6 fields from the sheet + 7 from the watch.
    expect(rows).toHaveLength(13);
    expect(rows.filter((r) => r.isSelected).length).toBeGreaterThan(0);
  });

  it('is better than either source alone', () => {
    // The point of the whole phase, stated as an assertion.
    const sheetOnly = ['weightKg', 'notes', 'visibilityM', 'site.name'];
    const watchOnly = ['durationS', 'profile', 'site.lat', 'site.lon'];
    for (const field of [...sheetOnly, ...watchOnly]) {
      expect(values[field], field).toBeDefined();
    }
  });
});

describe('mergeDive with genuinely conflicting sources', () => {
  it('flags the conflict and names the field', () => {
    const merged = mergeDive([
      {
        sourceId: 'a',
        sourceKind: 'uddf',
        recordedAt: RECORDED,
        fields: { maxDepthM: 14.0 },
      },
      {
        sourceId: 'b',
        sourceKind: 'uddf',
        recordedAt: LATER,
        fields: { maxDepthM: 31.0 },
      },
    ]);
    expect(merged.hasContestedFields).toBe(true);
    expect(merged.contestedFields).toEqual(['maxDepthM']);
  });

  it('handles a single source', () => {
    const merged = mergeDive([
      { sourceId: 'a', sourceKind: 'uddf', recordedAt: RECORDED, fields: { maxDepthM: 14 } },
    ]);
    expect(selectedValues(merged)['maxDepthM']).toBe(14);
    expect(merged.hasContestedFields).toBe(false);
  });

  it('handles no sources at all', () => {
    expect(mergeDive([])).toEqual({ fields: {}, hasContestedFields: false, contestedFields: [] });
  });

  it('drops a field every source left undefined', () => {
    const merged = mergeDive([
      {
        sourceId: 'a',
        sourceKind: 'uddf',
        recordedAt: RECORDED,
        fields: { maxDepthM: undefined, durationS: 2776 },
      },
    ]);
    expect(merged.fields['maxDepthM']).toBeUndefined();
    expect(merged.fields['durationS']).toBeDefined();
  });
});

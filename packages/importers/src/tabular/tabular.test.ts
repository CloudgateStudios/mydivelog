import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';
import { guessMapping } from './mapping.ts';
import { parseTabular } from './index.ts';

const table = parseCsv(
  readFileSync(
    fileURLToPath(new URL('../../../../fixtures/spreadsheet-sample.csv', import.meta.url)),
    'utf8',
  ),
);

describe('guessMapping against the real workbook headers', () => {
  const guesses = guessMapping(table.headers);
  const byHeader = new Map(guesses.map((g) => [g.header, g.field]));

  it('maps the columns that carry dive data', () => {
    expect(byHeader.get('Dive Number')).toBe('diveNumber');
    expect(byHeader.get('Max Depth (ft)')).toBe('maxDepthFt');
    expect(byHeader.get('Dive Site')).toBe('siteName');
    expect(byHeader.get('Location')).toBe('region');
    expect(byHeader.get('Dive Type')).toBe('tags');
    expect(byHeader.get('Weight (lbs)')).toBe('weightLb');
  });

  it('tells air and water temperature apart', () => {
    // Order matters in the pattern list: a looser temperature rule tested
    // first turns every temperature column into the air one.
    expect(byHeader.get('Air Temperature (F)')).toBe('airTempF');
    expect(byHeader.get('Water Temperature (F)')).toBe('waterTempF');
  });

  it('leaves the rollup columns unmapped rather than guessing', () => {
    expect(byHeader.get('Time Out')).toBeUndefined();
    expect(byHeader.get('Running Total Time')).toBeUndefined();
  });
});

describe('parseTabular against the real workbook', () => {
  const result = parseTabular(table.headers, table.rows);
  const first = result.observations[0];

  it('reads every row', () => {
    expect(result.observations).toHaveLength(table.rows.length);
    expect(result.fileIssues).toEqual([]);
  });

  it('combines the date serial and the day fraction into a wall clock', () => {
    // 41062 is 2012-06-02; 0.41180555… is 09:53.
    expect(first?.startTime.local?.toISOString()).toBe('2012-06-02T09:53:00.000Z');
  });

  it('leaves the offset unknown rather than inventing one', () => {
    // A spreadsheet records no timezone. Guessing from the server's zone is
    // how the same file imports differently in Chicago and in UTC.
    expect(first?.startTime.offsetMinutes).toBeUndefined();
    expect(first?.startTime.utc).toBeUndefined();
  });

  it('converts imperial measurements to SI', () => {
    expect(first?.maxDepthM).toBeCloseTo(5.1816, 4); // 17 ft
    expect(first?.airTempC).toBeCloseTo(23.889, 3); // 75 °F
    expect(first?.waterTempMinC).toBeCloseTo(18.333, 3); // 65 °F
    expect(first?.visibilityM).toBeCloseTo(6.096, 3); // 20 ft
    expect(first?.weightKg).toBeCloseTo(10.886, 3); // 24 lb
  });

  it('reads the duration day fraction', () => {
    expect(first?.durationS).toBe(1860); // 0.0215277… of a day = 31 min
  });

  it('treats N/A as absent, not as a site called N/A', () => {
    // 40+ rows of the real sheet carry N/A here.
    expect(first?.site?.name).toBeUndefined();
    expect(first?.site?.regionHint).toBe('Haigh Quarry');
  });

  it('splits the multi-value tag column without breaking quoted values', () => {
    const tagged = result.observations.find((o) => (o.tags?.length ?? 0) > 1);
    expect(tagged?.tags?.length).toBeGreaterThan(1);
    for (const o of result.observations) {
      for (const tag of o.tags ?? []) expect(tag).not.toMatch(/^\d{3} /);
    }
  });

  it('asks about each written tag once, not once per row', () => {
    const total = result.tagProposals.reduce((n, p) => n + p.occurrences, 0);
    expect(result.tagProposals.length).toBeLessThan(total);
    expect(result.tagProposals.every((p) => p.occurrences >= 1)).toBe(true);
  });

  it('flags Time Out as a sum of the columns it comes from', () => {
    expect(result.derived.map((d) => d.column)).toContain('Time Out');
  });

  it('cannot detect the running total in a row-subset fixture', () => {
    // Worth stating rather than leaving as a silent gap. The committed fixture
    // keeps non-contiguous rows of the real sheet, so `Running Total Time` is
    // a running sum of dives that are not in the file and no longer sums the
    // ones that are. Cumulative detection needs a complete, ordered sheet.
    //
    // Nothing imports it regardless: no mapping pattern claims it, so it lands
    // in `unmapped` and is dropped visibly.
    expect(result.derived.map((d) => d.column)).not.toContain('Running Total Time');
    expect(result.unmapped).toContain('Running Total Time');
  });

  it('does not flag a real measurement as derived', () => {
    const columns = result.derived.map((d) => d.column);
    expect(columns).not.toContain('Max Depth (ft)');
    expect(columns).not.toContain('Dive Time');
  });

  it('names the headers it ignored', () => {
    // Anything dropped is dropped visibly.
    expect(result.unmapped).toEqual(['Time Out', 'Running Total Time']);
  });

  it('keeps gear as written', () => {
    expect(first?.gear?.raw).toBe('Full Wet Suit (5mil Rental), Boots (5mil Rental)');
  });

  it('reads air as a 21% mix', () => {
    expect(first?.gases?.[0]?.o2Fraction).toBeCloseTo(0.21, 2);
  });

  it('reads an EAN percentage as a fraction', () => {
    const nitrox = result.observations.find((o) => (o.gases?.[0]?.o2Fraction ?? 0) > 0.21);
    expect(nitrox?.gases?.[0]?.o2Fraction).toBeGreaterThan(0.3);
    expect(nitrox?.gases?.[0]?.o2Fraction).toBeLessThan(0.4);
  });

  it('keeps the raw row on every observation', () => {
    expect(result.observations.every((o) => o.raw !== undefined)).toBe(true);
  });
});

describe('parseTabular on rows a human wrote', () => {
  const headers = ['Dive Number', 'Date', 'Time In', 'Max Depth (ft)', 'Dive Site'];
  const parse = (row: Record<string, string>) =>
    parseTabular(headers, [
      { 'Dive Number': '', Date: '', 'Time In': '', 'Max Depth (ft)': '', 'Dive Site': '', ...row },
    ]).observations[0];

  it('keeps a row whose dive number is the letter x', () => {
    // The real sheet numbers two rows `x`. The number is a display ordinal, so
    // an unreadable one costs the ordinal and nothing else.
    const o = parse({ 'Dive Number': 'x', Date: '41062', 'Time In': '0.5' });
    expect(o?.diveNumber).toBeUndefined();
    expect(o?.startTime.local).toBeDefined();
    expect(o?.issues.some((i) => i.code === 'unreadable_dive_number')).toBe(true);
  });

  it('reports a row with no date instead of dropping it silently', () => {
    const o = parse({ 'Dive Number': '5' });
    expect(o?.issues.some((i) => i.code === 'missing_date')).toBe(true);
  });

  it('reports an unreadable date', () => {
    const o = parse({ Date: 'last summer' });
    expect(o?.issues.some((i) => i.code === 'unreadable_date')).toBe(true);
  });

  it('reads an ISO date as well as a serial', () => {
    const o = parse({ Date: '2026-03-06', 'Time In': '0.5' });
    expect(o?.startTime.local?.toISOString()).toBe('2026-03-06T12:00:00.000Z');
  });

  it('reads a clock time as well as a day fraction', () => {
    // Reading only the day fraction meant a sheet full of `9:53` imported
    // every dive at midnight and said nothing about it.
    expect(parse({ Date: '41062', 'Time In': '9:53' })?.startTime.local?.toISOString()).toBe(
      '2012-06-02T09:53:00.000Z',
    );
    expect(parse({ Date: '41062', 'Time In': '9:53 PM' })?.startTime.local?.toISOString()).toBe(
      '2012-06-02T21:53:00.000Z',
    );
    expect(parse({ Date: '41062', 'Time In': '12:30 AM' })?.startTime.local?.toISOString()).toBe(
      '2012-06-02T00:30:00.000Z',
    );
  });

  it('places a dive at midnight when the time column is unusable, and says so', () => {
    const o = parse({ Date: '41062', 'Time In': 'after lunch' });
    expect(o?.startTime.local?.toISOString()).toBe('2012-06-02T00:00:00.000Z');
    expect(o?.issues.some((i) => i.code === 'unreadable_time')).toBe(true);
  });

  it('rejects a clock time that is not one', () => {
    expect(
      parse({ Date: '41062', 'Time In': '25:00' })?.issues.some(
        (i) => i.code === 'unreadable_time',
      ),
    ).toBe(true);
    expect(
      parse({ Date: '41062', 'Time In': '9:75' })?.issues.some((i) => i.code === 'unreadable_time'),
    ).toBe(true);
  });

  it('drops an impossible depth and says so', () => {
    const o = parse({ Date: '41062', 'Max Depth (ft)': '99999' });
    expect(o?.maxDepthM).toBeUndefined();
    expect(o?.issues.some((i) => i.code === 'out_of_range')).toBe(true);
  });

  it('reports an empty file', () => {
    expect(parseTabular(headers, []).fileIssues[0]?.code).toBe('no_rows');
  });
});

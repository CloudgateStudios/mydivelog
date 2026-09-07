import { describe, expect, it } from 'vitest';
import {
  templateCsv,
  templateExampleRow,
  templateFields,
  templateHeaders,
  templateOmits,
  templateXlsx,
  type UnitSystem,
} from './template.ts';
import { parseCsv } from '../tabular/csv.ts';
import { parseXlsx } from '../tabular/xlsx.ts';
import { parseTabular } from '../tabular/index.ts';
import { guessMapping, mappingFromGuesses, unmappedHeaders } from '../tabular/mapping.ts';

const SYSTEMS: UnitSystem[] = ['metric', 'imperial'];

/**
 * The template is the one file this product hands people. If it does not
 * import cleanly, nothing else in the importer matters much — so these do not
 * check that the generator produced *something*, they check that what it
 * produced goes all the way through.
 */
describe.each(SYSTEMS)('the %s template', (units) => {
  it('has a heading for every column that maps to the field it means', () => {
    // Not "maps to something": to the *right* thing. `Water Temperature (C)`
    // matching the air-temperature pattern would map, import, and be wrong.
    const headers = templateHeaders(units);
    const guesses = guessMapping(headers);
    expect(guesses.map((g) => g.field)).toEqual(templateFields(units));
  });

  it('leaves nothing unmapped', () => {
    const headers = templateHeaders(units);
    const mapping = mappingFromGuesses(guessMapping(headers));
    expect(unmappedHeaders(headers, mapping)).toEqual([]);
  });

  it('imports as a CSV, with the example row readable', () => {
    const table = parseCsv(templateCsv(units));
    const result = parseTabular(table.headers, table.rows);

    expect(result.fileIssues).toEqual([]);
    expect(result.unmapped).toEqual([]);
    expect(result.observations).toHaveLength(1);

    const dive = result.observations[0];
    expect(dive?.issues.filter((i) => i.severity === 'error')).toEqual([]);
    // The values a diver most needs to see the format of.
    expect(dive?.startTime.local?.toISOString()).toBe('2026-01-15T09:53:00.000Z');
    expect(dive?.durationS).toBe(46 * 60);
    expect(dive?.site?.name).toBe('Example Reef');
  });

  it('imports as a workbook, identically', () => {
    // The two downloads are the same sheet. A diver who takes one rather than
    // the other must not get a different logbook.
    const workbook = parseXlsx(templateXlsx(units));
    const csv = parseCsv(templateCsv(units));

    expect(workbook.sheetName).toBe('Dives');
    expect(workbook.headers).toEqual(csv.headers);
    expect(parseTabular(workbook.headers, workbook.rows).observations).toEqual(
      parseTabular(csv.headers, csv.rows).observations,
    );
  });

  it('reads depth in the units its heading claims', () => {
    // The whole point of two templates. 46 ft is 14.02 m; 14.1 m is 14.1 m.
    // Getting this backwards would silently record every dive at three times
    // its depth.
    const table = parseCsv(templateCsv(units));
    const dive = parseTabular(table.headers, table.rows).observations[0];
    expect(dive?.maxDepthM).toBeCloseTo(units === 'metric' ? 14.1 : 14.0208, 3);
  });

  it('does not look like a real dive the matcher will want to merge', () => {
    // A plausible site on a plausible date is one somebody's logbook may
    // already contain, and the review screen then asks them to resolve a
    // conflict with a row we invented. Every identifying value says "example".
    const row = templateExampleRow(units);
    const headers = templateHeaders(units);
    for (const column of ['Dive Site', 'Location', 'Buddy']) {
      expect(row[headers.indexOf(column)], column).toMatch(/example/i);
    }
  });

  it('says in the example row that it is one', () => {
    // It is a real row and will reach the review screen. It has to announce
    // itself there, in a column somebody reads.
    const notes = templateExampleRow(units)[templateHeaders(units).indexOf('Notes')];
    expect(notes).toMatch(/example/i);
    expect(notes).toMatch(/delete|skip/i);
  });

  it('puts the guidance where the reader will not import it', () => {
    // The notes sheet has no mappable heading row, so sheet selection walks
    // past it to the dives. If that ever stopped being true, the import would
    // silently become a sheet of prose.
    const workbook = parseXlsx(templateXlsx(units));
    expect(workbook.sheetNames).toContain('About these columns');
    expect(workbook.sheetName).toBe('Dives');
    expect(workbook.rows).toHaveLength(1);
  });
});

describe('what the template deliberately leaves out', () => {
  it('omits only the alternate units and the two awkward duration columns', () => {
    // A field missing here is either a decision or an oversight, and the
    // difference should not depend on anyone's memory. Metric templates skip
    // the imperial columns and vice versa; `durationDays` is an Excel day
    // fraction that nobody types by hand.
    expect(templateOmits('metric').sort()).toEqual(
      ['airTempF', 'durationDays', 'maxDepthFt', 'visibilityFt', 'waterTempF', 'weightLb'].sort(),
    );
    expect(templateOmits('imperial').sort()).toEqual(
      ['airTempC', 'durationDays', 'maxDepthM', 'visibilityM', 'waterTempC', 'weightKg'].sort(),
    );
  });
});

describe('the file itself', () => {
  it('is a workbook the reader recognises', () => {
    const bytes = templateXlsx('metric');
    expect(bytes.length).toBeGreaterThan(0);
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('quotes the values that contain commas', () => {
    // "Shore, Night" and "Full Wet Suit, Boots" are one cell each. Unquoted,
    // the example row gains columns and shifts.
    const csv = templateCsv('metric');
    expect(csv).toContain('"Shore, Night"');
    expect(parseCsv(csv).ragged).toEqual([]);
  });

  it('ends its lines the way a spreadsheet expects', () => {
    // Excel on Windows is the common case and it is happier with CRLF.
    expect(templateCsv('metric').split('\r\n')).toHaveLength(2);
  });
});

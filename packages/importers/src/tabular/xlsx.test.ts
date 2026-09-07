import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { columnIndex, isXlsx, parseXlsx, XlsxError } from './xlsx.ts';
import { buildWorkbook, zip } from './workbook-builder.ts';
import { parseCsv } from './csv.ts';
import { parseTabular } from './index.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url))),
  );

const HEAD = ['Dive Number', 'Date', 'Max Depth (ft)', 'Dive Site'];

describe('the real workbook', () => {
  /**
   * The strongest thing this suite says.
   *
   * `spreadsheet-sample.xlsx` and `spreadsheet-sample.csv` are the same 24
   * dives from the same real log, one as Excel wrote it and one flattened. If
   * the workbook reader is wrong in any way that matters — a shifted column, a
   * formula read as text, a lost decimal — these stop agreeing.
   */
  it('produces exactly what the same rows as CSV produce', () => {
    const workbook = parseXlsx(fixture('spreadsheet-sample.xlsx'));
    const csv = parseCsv(new TextDecoder().decode(fixture('spreadsheet-sample.csv')));

    const fromXlsx = parseTabular(workbook.headers, workbook.rows).observations;
    const fromCsv = parseTabular(csv.headers, csv.rows).observations;

    expect(fromXlsx).toHaveLength(24);
    expect(fromXlsx).toEqual(fromCsv);
  });

  it('names the sheet it read', () => {
    const workbook = parseXlsx(fixture('spreadsheet-sample.xlsx'));
    expect(workbook.sheetName).toBe('Dive Data');
    expect(workbook.headers).toHaveLength(19);
  });

  it('reports the cell typed outside the table rather than importing it', () => {
    // One row has a personal note one column past the last heading. Nothing
    // maps it, so it must be surfaced rather than silently dropped — or
    // silently absorbed into the column beside it.
    const workbook = parseXlsx(fixture('spreadsheet-sample.xlsx'));
    expect(workbook.ragged).toEqual([{ rowIndex: 1, fields: 20 }]);
    expect(Object.keys(workbook.rows[1] ?? {})).toHaveLength(19);
  });

  it('is recognised as a workbook from its bytes', () => {
    expect(isXlsx(fixture('spreadsheet-sample.xlsx'))).toBe(true);
    expect(isXlsx(fixture('uddf-sample.uddf'))).toBe(false);
    expect(isXlsx(fixture('spreadsheet-sample.csv'))).toBe(false);
  });
});

describe('sparse rows', () => {
  /**
   * The bug this reader exists to not have.
   *
   * Excel omits an empty cell rather than writing a blank one — 177 of the
   * original 197-row workbook's rows skip at least one column. Read in
   * document order, every value after the gap lands one column early: a max
   * depth becomes a time, and nothing raises an error.
   */
  it('places cells by their reference, not their position', () => {
    const workbook = buildWorkbook([
      {
        name: 'Log',
        rows: [
          HEAD,
          // Column C (max depth) is missing; the site must stay in column D.
          ['1', '41062', undefined, 'Angel City'],
        ],
      },
    ]);

    const row = parseXlsx(workbook).rows[0];
    expect(row?.['Max Depth (ft)']).toBe('');
    expect(row?.['Dive Site']).toBe('Angel City');
  });

  it('survives a row that is only its first and last cell', () => {
    const workbook = buildWorkbook([
      { name: 'Log', rows: [HEAD, ['7', undefined, undefined, 'Salt Pier']] },
    ]);
    expect(parseXlsx(workbook).rows[0]).toEqual({
      'Dive Number': '7',
      Date: '',
      'Max Depth (ft)': '',
      'Dive Site': 'Salt Pier',
    });
  });
});

describe('cells that are not plain values', () => {
  it('reads the cached result of a formula, never the formula', () => {
    // "Time Out" and "Running Total Time" are computed columns in the real
    // workbook — 378 such cells. Each carries the value Excel last worked out.
    const workbook = buildWorkbook([
      { name: 'Log', rows: [HEAD, ['1', '41062', { value: '17', formula: true }, 'Angel City']] },
    ]);
    expect(parseXlsx(workbook).rows[0]?.['Max Depth (ft)']).toBe('17');
  });

  it('treats a styled but valueless cell as empty', () => {
    // Excel pads with `<c r="K1000" s="2"/>` — a style and nothing else —
    // across hundreds of trailing rows. Counting those as rows turns 802 of
    // them into dives.
    const workbook = buildWorkbook([
      {
        name: 'Log',
        rows: [
          HEAD,
          ['1', '41062', '17', 'Angel City'],
          [
            { value: '', styleOnly: true },
            { value: '', styleOnly: true },
          ],
          [
            { value: '', styleOnly: true },
            { value: '', styleOnly: true },
          ],
        ],
      },
    ]);
    expect(parseXlsx(workbook).rows).toHaveLength(1);
  });

  it('keeps a number exactly as the file wrote it', () => {
    // A time of day is a fraction of a day and the digits are the precision.
    // Parsing to a float and printing it back loses the last one.
    const workbook = buildWorkbook([
      {
        name: 'Log',
        rows: [
          ['Dive Number', 'Date', 'Time In', 'Dive Site'],
          ['1', '41062', '0.41180555555555554', 'Angel City'],
        ],
      },
    ]);
    expect(parseXlsx(workbook).rows[0]?.['Time In']).toBe('0.41180555555555554');
  });
});

describe('choosing a sheet', () => {
  it('skips a sheet with no usable headings', () => {
    // A "Read me" tab in front of the data is common in a hand-made workbook.
    // Taking the first sheet regardless hands the diver an empty review screen
    // and no reason for it.
    const workbook = buildWorkbook([
      { name: 'Read me', rows: [['Fill this in and send it back'], ['Thanks!']] },
      { name: 'Dives', rows: [HEAD, ['1', '41062', '17', 'Angel City']] },
    ]);
    const parsed = parseXlsx(workbook);
    expect(parsed.sheetName).toBe('Dives');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.sheetNames).toEqual(['Read me', 'Dives']);
  });

  it('looks past a title sitting above the headings', () => {
    const workbook = buildWorkbook([
      {
        name: 'Log',
        rows: [['My Dive Log'], [], HEAD, ['1', '41062', '17', 'Angel City']],
      },
    ]);
    const parsed = parseXlsx(workbook);
    expect(parsed.headers).toEqual(HEAD);
    expect(parsed.rows).toHaveLength(1);
  });

  it('says so when no sheet has headings, rather than returning nothing', () => {
    const workbook = buildWorkbook([
      { name: 'Notes', rows: [['just'], ['some'], ['prose']] },
      { name: 'More', rows: [['and'], ['more']] },
    ]);
    expect(() => parseXlsx(workbook)).toThrow(XlsxError);
    expect(() => parseXlsx(workbook)).toThrow(/"Notes", "More"/);
  });
});

describe('files that are not workbooks', () => {
  const message = (bytes: Uint8Array): string => {
    try {
      parseXlsx(bytes);
      return 'no error';
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  it('refuses a file that is not an archive', () => {
    expect(message(new TextEncoder().encode('Dive Number,Date\n1,41062'))).toMatch(
      /not a readable/i,
    );
  });

  it('refuses a truncated archive', () => {
    const whole = buildWorkbook([{ name: 'Log', rows: [HEAD] }]);
    expect(message(whole.subarray(0, Math.floor(whole.length / 2)))).toMatch(/not a readable/i);
  });

  it('refuses an archive that is not a workbook', () => {
    // A .docx is a ZIP too, and so is anything renamed to .xlsx.
    const notAWorkbook = zip(new Map([['word/document.xml', new TextEncoder().encode('<w/>')]]));
    expect(isXlsx(notAWorkbook)).toBe(false);
    expect(message(notAWorkbook)).toMatch(/no workbook inside it/i);
  });

  it('refuses an empty file without throwing something unrecognisable', () => {
    expect(message(new Uint8Array(0))).toMatch(/not a readable/i);
  });
});

describe('a decompression bomb', () => {
  it('is refused from the declared size, before anything is inflated', () => {
    // A few hundred bytes that expand to gigabytes. The central directory says
    // how big each entry becomes, and that is checked first — so the refusal
    // costs nothing even when the claim is true.
    const zeros = new Uint8Array(1024 * 1024);
    const deflated = new Uint8Array(deflateRawSync(zeros));

    const nameBytes = new TextEncoder().encode('xl/workbook.xml');
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, deflated.length, true);
    lv.setUint32(22, 0xfffffffe, true); // claims ~4 GB
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, 8, true);
    dv.setUint32(20, deflated.length, true);
    dv.setUint32(24, 0xfffffffe, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, 0, true);
    dir.set(nameBytes, 46);

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, dir.length, true);
    ev.setUint32(16, local.length + deflated.length, true);

    const bomb = new Uint8Array(local.length + deflated.length + dir.length + eocd.length);
    let at = 0;
    for (const part of [local, deflated, dir, eocd]) {
      bomb.set(part, at);
      at += part.length;
    }

    expect(() => parseXlsx(bomb)).toThrow(/limit|not a readable/i);
  });
});

describe('column references', () => {
  it('reads spreadsheet column letters as indexes', () => {
    // Base-26 with no zero: A is 1, Z is 26, AA is 27. Off by one here shifts
    // every value in the sheet.
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA1')).toBe(26);
    expect(columnIndex('AB100')).toBe(27);
    expect(columnIndex('BA1')).toBe(52);
  });
});

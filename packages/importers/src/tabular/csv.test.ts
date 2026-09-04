import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, parseDelimited } from './csv.ts';

describe('parseDelimited', () => {
  it('does not split a quoted value containing the delimiter', () => {
    // `1,000 Steps` is one dive site. Splitting it invents a second.
    expect(parseDelimited('Boat,"1,000 Steps",Drift')).toEqual([['Boat', '1,000 Steps', 'Drift']]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseDelimited('a,"she said ""hi""",c')).toEqual([['a', 'she said "hi"', 'c']]);
  });

  it('keeps a quoted newline inside one field', () => {
    expect(parseDelimited('a,"line one\nline two",c')).toEqual([['a', 'line one\nline two', 'c']]);
  });

  it('handles CRLF, LF and a lone CR', () => {
    expect(parseDelimited('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseDelimited('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('reads the final row of a file with no trailing newline', () => {
    // The same omission that once made a shell script in this repo silently
    // skip its last line and pass every check.
    expect(parseDelimited('a,b\nc,d')).toHaveLength(2);
  });

  it('preserves empty fields rather than collapsing them', () => {
    // Sparse columns are the norm — air temp is filled on 33 of 197 rows.
    expect(parseDelimited('a,,c')).toEqual([['a', '', 'c']]);
  });
});

describe('detectDelimiter', () => {
  it.each([
    ['Dive Number,Date,Time In', ','],
    ['Dive Number\tDate\tTime In', '\t'],
    ['Dive Number;Date;Time In', ';'],
  ])('reads %s', (line, expected) => {
    expect(detectDelimiter(line)).toBe(expected);
  });

  it('is not fooled by a comma inside a quoted header', () => {
    expect(detectDelimiter('Site\t"Depth, ft"\tNotes')).toBe('\t');
  });
});

describe('parseCsv', () => {
  const table = parseCsv('Dive Number,Site,Notes\n1,"1,000 Steps",Good\n\n2,Angel City,');

  it('maps rows onto headers', () => {
    expect(table.headers).toEqual(['Dive Number', 'Site', 'Notes']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.['Site']).toBe('1,000 Steps');
  });

  it('skips blank spacing lines', () => {
    expect(table.rows.map((r) => r['Dive Number'])).toEqual(['1', '2']);
  });

  it('keeps a trailing empty field', () => {
    expect(table.rows[1]?.['Notes']).toBe('');
  });

  it('strips a byte order mark from the first header', () => {
    // A BOM survives into the header name and makes it match no mapping.
    expect(parseCsv('﻿Dive Number,Site\n1,x').headers[0]).toBe('Dive Number');
  });

  it('reports a ragged row instead of shifting every value one column left', () => {
    const r = parseCsv('a,b,c\n1,2\n3,4,5');
    expect(r.ragged).toEqual([{ rowIndex: 0, fields: 2 }]);
    expect(r.rows[0]?.['c']).toBe('');
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [], ragged: [] });
  });
});

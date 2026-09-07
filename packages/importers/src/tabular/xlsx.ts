import { XMLParser } from 'fast-xml-parser';
import { guessMapping } from './mapping.ts';
import { openZip, ZipError, type ZipArchive } from './zip.ts';
import type { CsvTable, Row } from './csv.ts';

/**
 * Excel workbooks, read into the same table `parseCsv` produces.
 *
 * Most divers' logs are `.xlsx`, not `.csv` — "save as CSV first" is a step
 * before the first step of the flow this product exists for. Once the rows are
 * out, nothing downstream needs to know where they came from: the same column
 * mapping, the same Excel serial dates, the same everything.
 *
 * Three things about the format cause almost every bug in a reader like this,
 * and all three came from looking at a real 197-dive workbook:
 *
 *  1. **Rows are sparse.** Excel omits empty cells entirely and names each one
 *     it does write. A row can run `A,B,C,D,G,I,…` with E, F and H simply
 *     absent — 177 of that workbook's 197 rows do. Reading cells in document
 *     order shifts every later value one column left, with no error: a max
 *     depth lands in "time out" and the logbook is quietly wrong. Cells are
 *     placed by their reference, never by their position.
 *  2. **Values live beside formulas, not in them.** 378 of those cells are
 *     formulas — the derived "time out" and "running total" columns. Each
 *     carries the last computed value next to it, and that cached value is
 *     what we read. Nothing here evaluates anything.
 *  3. **Numbers are text until the mapping says otherwise.** A date is the
 *     serial `41062` and a time is the fraction `0.4118…`. The tabular parser
 *     already understands both, from the CSV path, so the raw characters are
 *     passed through verbatim rather than parsed into a float and printed
 *     back — which is how `0.41180555555555554` becomes `0.4118055555555555`.
 */

/** Where the workbook's own parts live. Fixed by the format. */
const WORKBOOK = 'xl/workbook.xml';
const WORKBOOK_RELS = 'xl/_rels/workbook.xml.rels';
const SHARED_STRINGS = 'xl/sharedStrings.xml';
const CONTENT_TYPES = '[Content_Types].xml';

/**
 * How many mapped columns make a row a header rather than a coincidence.
 *
 * Three is enough to be sure and low enough to accept a sparse log with only a
 * date, a depth and a site. A title row ("My Dive Log") maps none.
 */
const HEADER_MIN_FIELDS = 3;

/** How far down a sheet to look for the header before giving up on it. */
const HEADER_SEARCH_ROWS = 10;

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

export type XlsxSheet = {
  name: string;
  /** Every non-empty row, each already placed into its columns. */
  grid: string[][];
};

export type XlsxTable = CsvTable & {
  /** Which sheet the rows came from, so the review screen can say. */
  sheetName: string;
  /** Every sheet found, for a message when none of them worked. */
  sheetNames: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Same reasoning as the UDDF parser: a cell holding `0.0` must stay `0.0`,
  // and a site named `00123` must not become the number 123.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

export function isXlsx(bytes: Uint8Array): boolean {
  try {
    const zip = openZip(bytes);
    // A .docx and a .jar are ZIPs too. The workbook part is what makes this a
    // workbook, and checking for it is cheaper and surer than the extension.
    return zip.has(WORKBOOK) || declaresSpreadsheet(zip);
  } catch {
    return false;
  }
}

function declaresSpreadsheet(zip: ZipArchive): boolean {
  try {
    return zip.has(CONTENT_TYPES) && zip.readText(CONTENT_TYPES).includes('spreadsheetml');
  } catch {
    return false;
  }
}

/**
 * Reads the first sheet whose header row maps to something.
 *
 * Not simply the first sheet: a hand-made workbook often opens with a
 * "Read me" or "Summary" tab, and taking that one hands the diver an empty
 * review screen with no explanation. Sheets are tried in the workbook's own
 * order, and within each, the first few rows are tried as the header — because
 * the other common shape is a title sitting above the real headings.
 */
export function parseXlsx(bytes: Uint8Array): XlsxTable {
  let zip: ZipArchive;
  try {
    zip = openZip(bytes);
  } catch (err) {
    throw new XlsxError(
      err instanceof ZipError
        ? `This file is not a readable Excel workbook: ${err.message}`
        : 'This file could not be opened as an Excel workbook.',
    );
  }

  if (!zip.has(WORKBOOK)) {
    throw new XlsxError(
      'This archive has no workbook inside it. A .docx or a .zip of spreadsheets will look ' +
        'like this; the file wanted is the .xlsx itself.',
    );
  }

  const shared = readSharedStrings(zip);
  const sheets = readSheets(zip, shared);
  if (sheets.length === 0) throw new XlsxError('This workbook has no sheets.');

  for (const sheet of sheets) {
    const found = headerRowIn(sheet);
    if (!found) continue;
    return {
      ...tableFrom(sheet.grid, found.index),
      sheetName: sheet.name,
      sheetNames: sheets.map((s) => s.name),
    };
  }

  // Every sheet was read and none had a usable header. Falling back to the
  // first sheet would produce a review screen full of unmapped columns; saying
  // so names the actual problem.
  const named = sheets.map((s) => `"${s.name}"`).join(', ');
  throw new XlsxError(
    `No sheet in this workbook has a row that looks like column headings. Looked at ${named}. ` +
      'The first row of the sheet should be the column names — Date, Max Depth, Dive Site and so on.',
  );
}

/** The shared string table. Text cells hold an index into it, not the text. */
function readSharedStrings(zip: ZipArchive): string[] {
  if (!zip.has(SHARED_STRINGS)) return [];
  const doc = parser.parse(zip.readText(SHARED_STRINGS)) as Record<string, unknown>;
  const sst = doc['sst'] as Record<string, unknown> | undefined;
  if (!sst) return [];

  return asArray(sst['si']).map((si) => {
    if (typeof si === 'string') return si;
    if (si === null || si === undefined) return '';
    const entry = si as Record<string, unknown>;
    // A string with mixed formatting is split into runs, each with its own
    // <t>. Concatenated, they are the one string the cell displays.
    if (entry['r'] !== undefined) {
      return asArray(entry['r'])
        .map((run) => textOf((run as Record<string, unknown>)['t']))
        .join('');
    }
    return textOf(entry['t']);
  });
}

function readSheets(zip: ZipArchive, shared: string[]): XlsxSheet[] {
  const doc = parser.parse(zip.readText(WORKBOOK)) as Record<string, unknown>;
  const workbook = doc['workbook'] as Record<string, unknown> | undefined;
  const container = workbook?.['sheets'] as Record<string, unknown> | undefined;
  const declared = asArray(container?.['sheet']) as Record<string, unknown>[];

  const targets = readRelationships(zip);
  const sheets: XlsxSheet[] = [];

  declared.forEach((sheet, index) => {
    const name = String(sheet['@name'] ?? `Sheet${index + 1}`);
    const relId = sheet['@r:id'];
    // The relationship is the reliable route; the conventional path is the
    // fallback, because a workbook saved by a tool other than Excel may number
    // its sheet parts differently from its sheet order.
    const target = typeof relId === 'string' ? targets.get(relId) : undefined;
    const path = target ?? `xl/worksheets/sheet${index + 1}.xml`;
    if (!zip.has(path)) return;
    sheets.push({ name, grid: readGrid(zip.readText(path), shared) });
  });

  return sheets;
}

function readRelationships(zip: ZipArchive): Map<string, string> {
  const targets = new Map<string, string>();
  if (!zip.has(WORKBOOK_RELS)) return targets;

  const doc = parser.parse(zip.readText(WORKBOOK_RELS)) as Record<string, unknown>;
  const container = doc['Relationships'] as Record<string, unknown> | undefined;
  for (const rel of asArray(container?.['Relationship']) as Record<string, unknown>[]) {
    const id = rel['@Id'];
    const target = rel['@Target'];
    if (typeof id !== 'string' || typeof target !== 'string') continue;
    // Targets are relative to the part that owns the relationships file, which
    // is xl/workbook.xml — so "worksheets/sheet1.xml" means xl/worksheets/….
    const clean = target.replace(/^\/+/, '').replace(/^xl\//, '');
    targets.set(id, `xl/${clean}`);
  }
  return targets;
}

/**
 * One worksheet, as a dense grid.
 *
 * This is where sparseness is undone. Every cell knows its own address, so
 * each row is filled by column index and the gaps become empty strings.
 */
function readGrid(xml: string, shared: string[]): string[][] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const worksheet = doc['worksheet'] as Record<string, unknown> | undefined;
  const sheetData = worksheet?.['sheetData'] as Record<string, unknown> | undefined;
  const rows = asArray(sheetData?.['row']) as Record<string, unknown>[];

  const grid: string[][] = [];

  for (const row of rows) {
    const cells = asArray(row['c']) as Record<string, unknown>[];
    const line: string[] = [];
    let widest = -1;

    cells.forEach((cell, position) => {
      const reference = cell['@r'];
      // Without a reference there is nothing better than position — rare, and
      // only in files written by something other than Excel.
      const column = typeof reference === 'string' ? columnIndex(reference) : position;
      const value = cellValue(cell, shared);
      if (column > widest) widest = column;
      while (line.length <= column) line.push('');
      line[column] = value;
    });

    // Excel keeps hundreds of empty <row> elements after the data — 802 of
    // them in the workbook this was written against. They are not rows.
    if (widest >= 0 && line.some((v) => v !== '')) grid.push(line);
  }

  return grid;
}

/**
 * "BQ12" → 68. Column letters are base-26 with no zero: A is 1, Z is 26,
 * AA is 27. Returned zero-based, so A is 0.
 */
export function columnIndex(reference: string): number {
  let n = 0;
  for (const ch of reference) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) n = n * 26 + (code - 64);
    else if (code >= 97 && code <= 122) n = n * 26 + (code - 96);
    else break;
  }
  return n - 1;
}

function cellValue(cell: Record<string, unknown>, shared: string[]): string {
  const type = cell['@t'];

  // An inline string carries its own text rather than a shared index.
  if (type === 'inlineStr') {
    const is = cell['is'] as Record<string, unknown> | undefined;
    if (!is) return '';
    if (is['r'] !== undefined) {
      return asArray(is['r'])
        .map((run) => textOf((run as Record<string, unknown>)['t']))
        .join('');
    }
    return textOf(is['t']);
  }

  // `<f>` is present on 378 cells of the reference workbook and is deliberately
  // ignored: `<v>` beside it is what Excel last computed, and evaluating a
  // spreadsheet formula language is not something an importer should do.
  const raw = textOf(cell['v']);
  if (raw === '') return '';

  if (type === 's') {
    const index = Number.parseInt(raw, 10);
    return Number.isInteger(index) ? (shared[index] ?? '') : '';
  }
  if (type === 'e') return ''; // #N/A, #DIV/0! — an error is not a value.
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';

  // Numbers, dates and formula-produced strings all pass through unchanged.
  return raw;
}

/** Which row in this sheet reads as column headings, if any. */
function headerRowIn(sheet: XlsxSheet): { index: number } | undefined {
  const limit = Math.min(sheet.grid.length, HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i += 1) {
    const candidate = (sheet.grid[i] ?? []).map((h) => h.trim());
    if (candidate.filter((h) => h !== '').length < HEADER_MIN_FIELDS) continue;
    const mapped = guessMapping(candidate).filter((g) => g.field !== undefined).length;
    if (mapped >= HEADER_MIN_FIELDS) return { index: i };
  }
  return undefined;
}

/** The grid below the header, as the rows every other stage already handles. */
function tableFrom(grid: string[][], headerIndex: number): CsvTable {
  const headers = (grid[headerIndex] ?? []).map((h) => h.trim());
  const rows: Row[] = [];
  const ragged: { rowIndex: number; fields: number }[] = [];

  grid.slice(headerIndex + 1).forEach((line, index) => {
    if (line.every((v) => v.trim() === '')) return;

    // Cells to the right of the last heading. Sparseness means a short row is
    // normal and says nothing; a long one means the sheet has data in columns
    // nothing named, which is worth surfacing.
    if (line.length > headers.length) ragged.push({ rowIndex: index, fields: line.length });

    const row: Row = {};
    headers.forEach((header, column) => {
      row[header] = (line[column] ?? '').trim();
    });
    rows.push(row);
  });

  return { headers, rows, ragged };
}

const asArray = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/** fast-xml-parser gives a bare string, an object with #text, or nothing. */
function textOf(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const text = (node as Record<string, unknown>)['#text'];
  return text === undefined ? '' : String(text);
}

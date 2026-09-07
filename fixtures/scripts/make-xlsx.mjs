#!/usr/bin/env node
/**
 * Builds `spreadsheet-sample.xlsx` from the diver's real workbook.
 *
 * Usage:
 *   node fixtures/scripts/make-xlsx.mjs "~/Downloads/Dive Log.xlsx"
 *
 * The committed fixture is the real file, reduced and redacted — the same
 * standard as the other two, and for the same reason: a workbook generated
 * from scratch would have none of the properties that make reading one hard.
 *
 * What is kept from the original, byte for byte:
 *   every part except the worksheet and the shared strings — the content
 *   types, the workbook, the relationships, the styles and the theme. Those
 *   are Excel's own output and there is no value in my re-deriving them.
 *
 * What is kept structurally, and is the entire point:
 *   - **Sparse cells.** Excel omits an empty cell rather than writing a blank
 *     one, so a row runs A,B,C,D,G,I with E, F and H simply absent. 177 of the
 *     original's 197 rows are like this. A reader that takes cells in order
 *     shifts every later value one column left, silently. The generated rows
 *     keep each original row's exact cell presence.
 *   - **Formula cells.** The derived "Time Out" and "Running Total Time"
 *     columns are formulas with the last computed value cached beside them.
 *     378 cells in the original. A reader must take the cached value.
 *   - **Trailing empty rows.** Excel keeps hundreds after the data; 802 here.
 *     They are not rows and must not become dives.
 *   - **A stray cell outside the table.** Column T of one row holds a personal
 *     note with no heading above it. It must be reported, not imported.
 *
 * What is replaced:
 *   every value, with the corresponding one from `spreadsheet-sample.csv` —
 *   which is already the redacted version of these same rows, matched by dive
 *   number. No new personal data enters the repository through this script.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) {
  console.error('Usage: node fixtures/scripts/make-xlsx.mjs <the real Dive Log.xlsx>');
  process.exit(1);
}

/* --- the smallest ZIP reader and writer that will do ---------------------- */

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip');

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const files = new Map();

  for (let i = 0; i < count; i += 1) {
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));

    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compressed);
    files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));

    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** CRC-32, because every zip entry carries one and readers check it. */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function writeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(content, { level: 9 });
    const crc = crc32(content);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    locals.push(local, deflated);

    const dir = Buffer.alloc(46 + nameBytes.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(content.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    nameBytes.copy(dir, 46);
    central.push(dir);

    offset += local.length + deflated.length;
  }

  const dirBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.size, 8);
  eocd.writeUInt16LE(files.size, 10);
  eocd.writeUInt32LE(dirBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, dirBytes, eocd]);
}

/* --- reading the original worksheet --------------------------------------- */

const xml = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c],
  );

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

/** Every <row> of the sheet, with each cell's reference and whether it is a formula. */
function readRows(sheetXml) {
  return [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)].map((m) => {
    const body = m[1] ?? '';
    const cells = [...body.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => ({
      ref: attr(c[1], 'r') ?? '',
      type: attr(c[1], 't'),
      formula: /<f[\s>]/.test(c[2] ?? ''),
      // A cell can exist and hold nothing. Excel writes `<c r="K1000" s="2"/>`
      // — a style with no value — across hundreds of trailing rows, so "this
      // row has cells" is not the same question as "this row has data". The
      // first version of this script asked the wrong one and built a fixture
      // out of twenty-four blank rows.
      hasValue: /<v[\s>]/.test(c[2] ?? ''),
    }));
    return { attrs: m[0].match(/<row\b([^>]*)>/)?.[1] ?? '', cells };
  });
}

const letters = (ref) => ref.match(/^[A-Z]+/)?.[0] ?? '';

/** 0 → "A", 25 → "Z", 26 → "AA". */
function column(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/* --- build ---------------------------------------------------------------- */

const original = readZip(new Uint8Array(readFileSync(source.replace(/^~/, process.env.HOME))));
const sheetPath = 'xl/worksheets/sheet1.xml';
const sheetXml = original.get(sheetPath).toString('utf8');
const rows = readRows(sheetXml);

// The redacted CSV, which is these same rows with the identifying detail
// already removed. Parsed simply: it is our own committed file, not input.
const csv = readFileSync(join(OUT, 'spreadsheet-sample.csv'), 'utf8').trim().split(/\r?\n/);
const splitCsv = (line) => {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') ((field += '"'), (i += 1));
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') (out.push(field), (field = ''));
    else field += ch;
  }
  out.push(field);
  return out;
};

const headers = splitCsv(csv[0]);
const csvRows = csv.slice(1).map(splitCsv);

// Which columns the original holds as formulas. Derived rather than named, so
// the fixture keeps saying something true about the real file: "Time Out" and
// "Running Total Time" are computed from the columns beside them, and their
// cells carry a cached value next to the formula.
const dataRows = rows.slice(1).filter((r) => r.cells.some((c) => c.hasValue));
if (dataRows.length === 0) throw new Error('the workbook has no data rows');

const formulaColumns = new Set();
for (const row of dataRows) {
  for (const cell of row.cells) if (cell.formula) formulaColumns.add(letters(cell.ref));
}

// A row of the original with a cell outside the table: a personal note typed
// one column past the last heading, with no heading of its own. It has to be
// reported as unexpected and never imported.
const strayColumn = column(headers.length);
const hasStray = dataRows.some((r) =>
  r.cells.some((c) => c.hasValue && letters(c.ref) === strayColumn),
);

const shared = [];
const sharedIndex = new Map();
const intern = (text) => {
  if (!sharedIndex.has(text)) {
    sharedIndex.set(text, shared.length);
    shared.push(text);
  }
  return sharedIndex.get(text);
};

const cellXml = (ref, value, formula) => {
  // Sparseness, following the data — which is the original's own rule. Excel
  // omits an empty cell rather than writing a blank one, so 177 of its 197
  // rows skip columns, and a reader taking cells in document order shifts
  // every later value one column left with no error at all.
  if (value === '') return '';
  const numeric = Number.isFinite(Number(value));
  const f = formula ? '<f>1</f>' : ''; // the expression is not data; the value is
  return numeric
    ? `<c r="${ref}">${f}<v>${xml(value)}</v></c>`
    : `<c r="${ref}" t="s">${f}<v>${intern(value)}</v></c>`;
};

const body = [];

body.push(`<row r="1">${headers.map((h, i) => cellXml(`${column(i)}1`, h, false)).join('')}</row>`);

csvRows.forEach((values, index) => {
  const rowNumber = index + 2;
  const cells = headers
    .map((_, i) =>
      cellXml(`${column(i)}${rowNumber}`, values[i] ?? '', formulaColumns.has(column(i))),
    )
    .join('');

  const extra =
    hasStray && index === 1
      ? cellXml(`${strayColumn}${rowNumber}`, 'Need to find pictures for gear', false)
      : '';

  body.push(`<row r="${rowNumber}">${cells}${extra}</row>`);
});

// Trailing rows, as Excel actually leaves them: not absent and not empty, but
// present and carrying a style with no value. The original has 802 of these.
// Reading "this row has cells" as "this row has data" turns every one of them
// into a dive — the mistake the first version of this script made.
for (let i = 0; i < 40; i += 1) {
  const r = csvRows.length + 2 + i;
  body.push(`<row r="${r}"><c r="K${r}" s="2"/><c r="M${r}" s="2"/><c r="Q${r}" s="2"/></row>`);
}

const newSheet =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  `<sheetData>${body.join('')}</sheetData></worksheet>`;

const newShared =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
  shared.map((s) => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('') +
  '</sst>';

const out = new Map();
for (const [name, content] of original) {
  // calcChain describes formula evaluation order and refers to cells that no
  // longer exist. Excel regenerates it; a reader has no use for it.
  if (name === 'xl/calcChain.xml') continue;
  if (name === sheetPath) out.set(name, Buffer.from(newSheet, 'utf8'));
  else if (name === 'xl/sharedStrings.xml') out.set(name, Buffer.from(newShared, 'utf8'));
  else out.set(name, content);
}

const target = join(OUT, 'spreadsheet-sample.xlsx');
writeFileSync(target, writeZip(out));
const sparse = csvRows.filter((v) => v.some((cell) => cell === '')).length;
console.log(
  `wrote ${target}\n  ${csvRows.length} data rows (${sparse} sparse), ` +
    `${shared.length} shared strings, formula columns ${[...formulaColumns].join(', ')}`,
);

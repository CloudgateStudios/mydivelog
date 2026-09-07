import { deflateRawSync } from 'node:zlib';

/**
 * Writes .xlsx files.
 *
 * Small on purpose: enough of the format to produce a workbook Excel, Numbers
 * and Google Sheets all open, and no more. It has two callers and they want
 * opposite things from it, which is why it takes a grid rather than a document
 * model:
 *
 *   - the blank import template a diver downloads, which must contain exactly
 *     the columns this importer knows how to read;
 *   - the tests, which need to write down a hazard — a sparse row, a formula,
 *     a title above the headings, a second sheet — precisely rather than hunt
 *     for one in a binary fixture.
 *
 * `undefined` in a row omits the cell entirely, which is what Excel itself
 * does with an empty one and the single most important thing to get right when
 * reading one back.
 */

export type CellSpec = string | { value: string; formula?: boolean; styleOnly?: boolean };

export type SheetSpec = {
  name: string;
  /** `undefined` in a row leaves the cell out entirely, as Excel does. */
  rows: (CellSpec | undefined)[][];
};

/** Quotes included: a sheet name goes into an attribute, and one `"` there
 *  ends the attribute early and produces a file Excel would never write. */
const xml = (s: string): string =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string,
  );

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function buildWorkbook(sheets: SheetSpec[]): Uint8Array {
  const shared: string[] = [];
  const index = new Map<string, number>();
  const intern = (text: string): number => {
    const found = index.get(text);
    if (found !== undefined) return found;
    index.set(text, shared.length);
    shared.push(text);
    return shared.length - 1;
  };

  const parts = new Map<string, Uint8Array>();

  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows.map((cells, r) => {
      const rowNumber = r + 1;
      const body = cells
        .map((cell, c) => {
          if (cell === undefined) return '';
          const spec = typeof cell === 'string' ? { value: cell } : cell;
          const ref = `${columnName(c)}${rowNumber}`;
          if (spec.styleOnly) return `<c r="${ref}" s="2"/>`;
          if (spec.value === '') return '';
          const f = spec.formula ? '<f>A1+1</f>' : '';
          return Number.isFinite(Number(spec.value))
            ? `<c r="${ref}">${f}<v>${xml(spec.value)}</v></c>`
            : `<c r="${ref}" t="s">${f}<v>${intern(spec.value)}</v></c>`;
        })
        .join('');
      return `<row r="${rowNumber}">${body}</row>`;
    });

    parts.set(
      `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          `<sheetData>${rows.join('')}</sheetData></worksheet>`,
      ),
    );
  });

  parts.set(
    'xl/sharedStrings.xml',
    encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
        shared.map((s) => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('') +
        '</sst>',
    ),
  );

  parts.set(
    'xl/workbook.xml',
    encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets
          .map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('') +
        '</sheets></workbook>',
    ),
  );

  parts.set(
    'xl/_rels/workbook.xml.rels',
    encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        '</Relationships>',
    ),
  );

  parts.set(
    '[Content_Types].xml',
    encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '</Types>',
    ),
  );

  return zip(parts);
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** CRC-32, because a zip entry carries one and readers check it. */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = -1;
  for (const b of bytes) c = (CRC[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Deliberately minimal, and deliberately not the reader under test. */
export function zip(parts: Map<string, Uint8Array>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of parts) {
    const nameBytes = new TextEncoder().encode(name);
    const deflated = new Uint8Array(deflateRawSync(content));
    const sum = crc32(content);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, deflated.length, true);
    lv.setUint32(22, content.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, deflated);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, 8, true);
    dv.setUint32(16, sum, true);
    dv.setUint32(20, deflated.length, true);
    dv.setUint32(24, content.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    central.push(dir);

    offset += local.length + deflated.length;
  }

  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.size, true);
  ev.setUint16(10, parts.size, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, eocd];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

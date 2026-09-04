/**
 * RFC 4180 CSV reading.
 *
 * Hand-rolled rather than pulled in, because the requirement is small and
 * specific: quote-aware field splitting that never mangles `1,000 Steps`, and
 * a tolerance for the newline conventions real exports actually use.
 */

export type Row = Record<string, string>;

export type CsvTable = {
  headers: string[];
  rows: Row[];
  /** Rows whose field count did not match the header. */
  ragged: { rowIndex: number; fields: number }[];
};

/** Splits one delimited line, respecting quotes and doubled escapes. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i] as string;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (char === delimiter) {
      endField();
      i++;
      continue;
    }
    if (char === '\r') {
      // CRLF, and a lone CR from a very old export.
      if (text[i + 1] === '\n') i++;
      endRow();
      i++;
      continue;
    }
    if (char === '\n') {
      endRow();
      i++;
      continue;
    }
    field += char;
    i++;
  }

  // A file with no trailing newline still ends a row — the same omission that
  // once made a shell script skip its own last line of input.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/** Guesses the delimiter from the header line. Exports are not all comma-separated. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/));
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    // Count outside quotes only, so a comma inside `"1,000 Steps"` does not
    // vote for itself.
    const count = parseDelimited(firstLine, candidate)[0]?.length ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter?: string): CsvTable {
  // A BOM survives into the first header name and makes it match nothing.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const grid = parseDelimited(clean, delimiter ?? detectDelimiter(clean));
  const [headerRow, ...body] = grid;
  if (!headerRow) return { headers: [], rows: [], ragged: [] };

  const headers = headerRow.map((h) => h.trim());
  const rows: Row[] = [];
  const ragged: { rowIndex: number; fields: number }[] = [];

  body.forEach((fields, index) => {
    // A wholly empty line is spacing, not a row.
    if (fields.every((f) => f.trim() === '')) return;
    if (fields.length !== headers.length) ragged.push({ rowIndex: index, fields: fields.length });

    const row: Row = {};
    headers.forEach((header, column) => {
      row[header] = fields[column] ?? '';
    });
    rows.push(row);
  });

  return { headers, rows, ragged };
}

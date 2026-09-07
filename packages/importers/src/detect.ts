import { isXlsx } from './tabular/xlsx.ts';

/**
 * Format detection.
 *
 * Sniffs content, not the extension. A diver exporting from a tool they do not
 * fully understand ends up with `divelog.txt` holding XML, or a `.csv` that is
 * tab-separated, and refusing those teaches them the product is fussy rather
 * than that their file is.
 */

export const DETECTED_FORMATS = [
  'uddf',
  'mydivelog',
  'subsurface',
  'spreadsheet',
  'xlsx',
  'unknown',
] as const;
export type DetectedFormat = (typeof DETECTED_FORMATS)[number];

export type Detection = {
  format: DetectedFormat;
  /** What in the file said so, shown when a diver disagrees with the guess. */
  reason: string;
};

/**
 * Detection from the raw upload.
 *
 * An .xlsx is a ZIP archive, so it has to be recognised before anything tries
 * to read it as text — decoded as UTF-8 it is binary noise that matches
 * nothing, which is exactly what it did: every Excel workbook was reported as
 * "not a format MyDiveLog can read yet" while its contents were perfectly
 * ordinary. Everything else is text, so this checks the one binary format and
 * then hands over.
 */
export function detectUpload(bytes: Uint8Array, fileName?: string): Detection {
  if (isXlsx(bytes)) {
    return { format: 'xlsx', reason: 'The file is an Excel workbook.' };
  }
  return detectFormat(new TextDecoder().decode(bytes), fileName);
}

export function detectFormat(text: string, fileName?: string): Detection {
  const head = text.slice(0, 4096);

  // A workbook that reached the text path — a caller that decoded before
  // asking. Naming it is better than reporting "unknown" for a file we can
  // in fact read, since the fix is to call `detectUpload` with the bytes.
  if (head.startsWith('PK\u0003\u0004')) {
    return {
      format: 'xlsx',
      reason: 'The file is a ZIP archive, which is what an Excel workbook is.',
    };
  }

  if (/<uddf[\s>]/i.test(head)) {
    return { format: 'uddf', reason: 'The document has a <uddf> root element.' };
  }
  if (/<divelog[\s>]/i.test(head) && /subsurface/i.test(head)) {
    return { format: 'subsurface', reason: 'The document is a Subsurface divelog.' };
  }
  if (/"format"\s*:\s*"mydivelog-logbook/.test(head)) {
    return { format: 'mydivelog', reason: 'The file declares the MyDiveLog export format.' };
  }

  // Tabular last: almost anything can be read as one column of nothing, so it
  // has to be the fallback rather than a match.
  const firstLine = head.split(/\r?\n/, 1)[0] ?? '';
  const separators = (firstLine.match(/[,\t;|]/g) ?? []).length;
  if (separators >= 2 && !firstLine.trimStart().startsWith('<')) {
    return {
      format: 'spreadsheet',
      reason: `The first line looks like a header row with ${separators + 1} columns.`,
    };
  }

  const extension = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === 'xlsx') {
    return {
      format: 'xlsx',
      reason: 'Nothing in the content identified it; falling back to the .xlsx extension.',
    };
  }
  if (extension === 'uddf' || extension === 'xml') {
    return {
      format: 'uddf',
      reason: `Nothing in the content identified it; falling back to the .${extension} extension.`,
    };
  }

  return {
    format: 'unknown',
    reason: 'Nothing in the content or the file name identified a known format.',
  };
}

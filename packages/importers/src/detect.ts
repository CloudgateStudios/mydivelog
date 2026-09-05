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
  'unknown',
] as const;
export type DetectedFormat = (typeof DETECTED_FORMATS)[number];

export type Detection = {
  format: DetectedFormat;
  /** What in the file said so, shown when a diver disagrees with the guess. */
  reason: string;
};

export function detectFormat(text: string, fileName?: string): Detection {
  const head = text.slice(0, 4096);

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

import { slugify } from '@mydivelog/domain';

/**
 * Column mapping.
 *
 * The long tail of "my weird spreadsheet" is infinite, so the answer is a good
 * mapper with shareable templates rather than an importer per diver. This
 * module guesses a mapping; the diver corrects it; the correction is saved as
 * a `MappingProfile` and reused.
 *
 * Guessing is a convenience, never an authority. Every guess carries a
 * confidence and every one is overridable, because a wrong guess that imports
 * silently is worse than no guess at all.
 */

export const IMPORT_FIELDS = [
  'diveNumber',
  'date',
  'timeIn',
  'durationDays',
  'durationMinutes',
  'maxDepthFt',
  'maxDepthM',
  'airTempF',
  'airTempC',
  'waterTempF',
  'waterTempC',
  'visibilityFt',
  'visibilityM',
  'region',
  'siteName',
  'waterType',
  'tags',
  'gasLabel',
  'eanPercent',
  'gear',
  'weightLb',
  'weightKg',
  'notes',
  'buddies',
  'rating',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export type ColumnMapping = {
  /** Header text → the field it feeds. Absent headers are ignored. */
  columns: Record<string, ImportField>;
  /** Values that mean "absent" in this particular sheet. */
  nullTokens?: string[];
};

/**
 * Header patterns, most specific first. Order matters: `Water Temperature (F)`
 * has to be tested before `Temperature`, or every temperature column becomes
 * the air one.
 */
const PATTERNS: readonly { field: ImportField; test: RegExp }[] = [
  { field: 'diveNumber', test: /^dive-?(number|no|num|#)?$/ },
  { field: 'date', test: /^date$|^dive-date$/ },
  { field: 'timeIn', test: /^time-?in$|^start-?time$|^entry-?time$/ },
  { field: 'durationDays', test: /^dive-?time$|^bottom-?time$/ },
  { field: 'durationMinutes', test: /^duration(-min(utes)?)?$|^dive-?time-?min(utes)?$/ },
  { field: 'maxDepthFt', test: /^(max-?)?depth.*-?ft|^(max-?)?depth.*feet/ },
  { field: 'maxDepthM', test: /^(max-?)?depth.*-?m$|^(max-?)?depth.*met(re|er)/ },
  { field: 'airTempF', test: /^air-?temp.*f\)?$|^air-?temp.*fahrenheit/ },
  { field: 'airTempC', test: /^air-?temp.*c\)?$|^air-?temp.*celsius/ },
  { field: 'waterTempF', test: /^water-?temp.*f\)?$|^water-?temp.*fahrenheit/ },
  { field: 'waterTempC', test: /^water-?temp.*c\)?$|^water-?temp.*celsius/ },
  { field: 'visibilityFt', test: /^vis(ibility)?.*-?ft|^vis(ibility)?.*feet/ },
  { field: 'visibilityM', test: /^vis(ibility)?.*-?m$|^vis(ibility)?.*met(re|er)/ },
  { field: 'region', test: /^location$|^region$|^country$|^area$/ },
  { field: 'siteName', test: /^dive-?site$|^site$|^site-?name$/ },
  { field: 'waterType', test: /^water-?type$|^water$/ },
  { field: 'tags', test: /^dive-?type$|^type$|^tags?$/ },
  { field: 'eanPercent', test: /^ean-?%?$|^o2-?%?$|^nitrox-?%?$|^ean-?percent$/ },
  { field: 'gasLabel', test: /^gas$|^mix$|^breathing-?gas$/ },
  { field: 'gear', test: /^equipment$|^gear$/ },
  { field: 'weightLb', test: /^weight.*-?lbs?\)?$|^weight.*pounds/ },
  { field: 'weightKg', test: /^weight.*-?kg\)?$|^weight.*kilo/ },
  { field: 'notes', test: /^notes?$|^comments?$|^remarks?$/ },
  { field: 'buddies', test: /^budd(y|ies)$|^partner$/ },
  { field: 'rating', test: /^rating$|^stars$/ },
];

export type ColumnGuess = {
  header: string;
  field?: ImportField;
  confidence: 'high' | 'none';
};

/**
 * Proposes a mapping from header text.
 *
 * A header that matches nothing is left unmapped rather than forced onto the
 * nearest field. The diver sees it in the mapping UI and decides; guessing
 * wrong here writes bad data into a permanent record.
 */
export function guessMapping(headers: readonly string[]): ColumnGuess[] {
  const taken = new Set<ImportField>();
  return headers.map((header) => {
    const slug = slugify(header);
    const hit = PATTERNS.find((p) => p.test.test(slug) && !taken.has(p.field));
    if (!hit) return { header, confidence: 'none' };
    taken.add(hit.field);
    return { header, field: hit.field, confidence: 'high' };
  });
}

export function mappingFromGuesses(guesses: readonly ColumnGuess[]): ColumnMapping {
  const columns: Record<string, ImportField> = {};
  for (const g of guesses) if (g.field) columns[g.header] = g.field;
  return { columns };
}

/** Which headers a mapping ignores — shown so nothing is dropped invisibly. */
export function unmappedHeaders(headers: readonly string[], mapping: ColumnMapping): string[] {
  return headers.filter((h) => mapping.columns[h] === undefined);
}

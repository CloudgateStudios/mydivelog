import {
  checkRange,
  cleanNumber,
  cleanText,
  completeTime,
  dayFractionToSeconds,
  detectDerivedColumns,
  emptyObservation,
  excelSerialToUtcDate,
  fahrenheitToCelsius,
  feetToMetres,
  issue,
  matchTags,
  percentToFraction,
  poundsToKilograms,
  proposeTags,
  SEED_DIVE_TYPE_TAGS,
  splitValues,
  WATER_TYPES,
  type DerivedColumn,
  type DiveObservation,
  type Issue,
  type TagProposal,
  type TaxonomyEntry,
  type WaterType,
} from '@mydivelog/domain';
import type { Row } from './csv.ts';
import {
  guessMapping,
  mappingFromGuesses,
  unmappedHeaders,
  type ColumnMapping,
} from './mapping.ts';

export const SPREADSHEET_SOURCE_KIND = 'spreadsheet';

export type TabularParseOptions = {
  mapping?: ColumnMapping;
  taxonomy?: readonly TaxonomyEntry[];
  /** Excel serials are days since 1899-12-30; some exports write ISO dates. */
  dateFormat?: 'auto' | 'excel-serial' | 'iso';
};

export type TabularParseResult = {
  observations: DiveObservation[];
  mapping: ColumnMapping;
  /** Headers the mapping ignores. Shown so nothing is dropped invisibly. */
  unmapped: string[];
  /** Rollups, defaulted to ignore. */
  derived: DerivedColumn[];
  /** One question per distinct written tag, not one per row. */
  tagProposals: TagProposal[];
  fileIssues: Issue[];
};

/**
 * The generic tabular importer.
 *
 * Everything a human spreadsheet does to data happens here: dates as serials,
 * times as day fractions, `N/A` for null, typos that became taxonomy,
 * delimiters inside values, rollup columns, and imperial units throughout.
 */
export function parseTabular(
  headers: readonly string[],
  rows: readonly Row[],
  options: TabularParseOptions = {},
): TabularParseResult {
  const mapping = options.mapping ?? mappingFromGuesses(guessMapping(headers));
  const taxonomy = options.taxonomy ?? SEED_DIVE_TYPE_TAGS;

  const derived = detectDerivedColumns(numericColumns(headers, rows, mapping));
  const observations = rows.map((row, index) =>
    readRow(row, index, mapping, options.dateFormat ?? 'auto'),
  );

  const tagProposals = proposeTags(
    rows.flatMap((row) => {
      const cell = cellFor(row, mapping, 'tags');
      return cell === undefined ? [] : matchTags(cell, taxonomy);
    }),
  );

  const fileIssues: Issue[] =
    rows.length === 0 ? [issue('warning', 'no_rows', 'This file contains no data rows.')] : [];

  return {
    observations,
    mapping,
    unmapped: unmappedHeaders(headers, mapping),
    derived,
    tagProposals,
    fileIssues,
  };
}

/**
 * Numeric view of the sheet for derived-column detection. Unmapped columns are
 * included deliberately: `Running Total Time` and `Time Out` are exactly the
 * columns nothing maps to, and they are the ones worth naming.
 */
function numericColumns(
  headers: readonly string[],
  rows: readonly Row[],
  _mapping: ColumnMapping,
): Record<string, (number | undefined)[]> {
  const out: Record<string, (number | undefined)[]> = {};
  for (const header of headers) {
    const values = rows.map((row) => cleanNumber(row[header]));
    // A column with no numbers in it cannot be a formula over numbers.
    if (values.some((v) => v !== undefined)) out[header] = values;
  }
  return out;
}

const cellFor = (row: Row, mapping: ColumnMapping, field: string): string | undefined => {
  for (const [header, mapped] of Object.entries(mapping.columns)) {
    if (mapped === field) return cleanText(row[header], mapping.nullTokens);
  }
  return undefined;
};

const numberFor = (row: Row, mapping: ColumnMapping, field: string): number | undefined => {
  const cell = cellFor(row, mapping, field);
  return cell === undefined ? undefined : cleanNumber(cell, mapping.nullTokens);
};

function readRow(
  row: Row,
  index: number,
  mapping: ColumnMapping,
  dateFormat: 'auto' | 'excel-serial' | 'iso',
): DiveObservation {
  const obs = emptyObservation(SPREADSHEET_SOURCE_KIND, row, cellFor(row, mapping, 'date') ?? '');

  readTime(obs, row, mapping, dateFormat, index);
  readDepthAndDuration(obs, row, mapping);
  readTemperatures(obs, row, mapping);
  readSiteAndTags(obs, row, mapping);
  readGasAndGear(obs, row, mapping);

  // The seed workbook numbers two rows `x`, and 196 distinct values cover 197
  // rows. A dive number is a display ordinal the diver assigned, so a
  // non-numeric one is worth noting and not worth failing over.
  const numberCell = cellFor(row, mapping, 'diveNumber');
  const diveNumber = numberCell === undefined ? undefined : cleanNumber(numberCell);
  if (diveNumber !== undefined) obs.diveNumber = Math.round(diveNumber);
  else if (numberCell !== undefined) {
    obs.issues.push(
      issue(
        'info',
        'unreadable_dive_number',
        `Dive number "${numberCell}" is not a number; it will be assigned on import.`,
        'diveNumber',
      ),
    );
  }

  const notes = cellFor(row, mapping, 'notes');
  if (notes !== undefined) obs.notes = notes;

  const buddies = cellFor(row, mapping, 'buddies');
  if (buddies !== undefined) obs.buddies = splitValues(buddies);

  const rating = numberFor(row, mapping, 'rating');
  const checkedRating = checkRange('rating', rating);
  obs.issues.push(...checkedRating.issues);
  if (checkedRating.value !== undefined) obs.rating = checkedRating.value;

  return obs;
}

function readTime(
  obs: DiveObservation,
  row: Row,
  mapping: ColumnMapping,
  dateFormat: 'auto' | 'excel-serial' | 'iso',
  index: number,
): void {
  const dateCell = cellFor(row, mapping, 'date');
  if (dateCell === undefined) {
    obs.issues.push(
      issue(
        'error',
        'missing_date',
        `Row ${index + 1} has no date, so it cannot be placed in a logbook.`,
        'startTime',
      ),
    );
    return;
  }

  const date = readDate(dateCell, dateFormat);
  if (!date) {
    obs.issues.push(
      issue('error', 'unreadable_date', `Could not read the date "${dateCell}".`, 'startTime'),
    );
    return;
  }

  // Time lives in its own column, as a day fraction in this workbook
  // (0.41180555… is 09:53) but as clock text in plenty of others.
  const timeCell = cellFor(row, mapping, 'timeIn');
  let seconds = 0;
  if (timeCell !== undefined) {
    const parsed = readTimeOfDay(timeCell);
    if (parsed === undefined) {
      obs.issues.push(
        issue(
          'warning',
          'unreadable_time',
          `Start time "${timeCell}" is not a time of day; the dive is placed at midnight.`,
          'startTime',
        ),
      );
    } else {
      seconds = parsed;
    }
  }

  // A spreadsheet records wall clock and no zone. That is genuinely all the
  // diver wrote down, so the offset stays unknown rather than being invented
  // from the server's timezone or from a site we have not resolved yet.
  obs.startTime = completeTime({
    local: new Date(date.getTime() + seconds * 1000),
    raw: obs.startTime.raw,
  });
}

/**
 * Seconds since midnight, from either representation.
 *
 * A day fraction is what Excel stores; `09:53` and `9:53 PM` are what people
 * type. Reading only the first meant a sheet full of clock times imported
 * every dive at midnight without saying a word.
 */
export function readTimeOfDay(cell: string): number | undefined {
  const text = cell.trim();

  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text);
  if (clock) {
    const [, h, m, sec, meridiem] = clock;
    let hours = Number(h);
    const minutes = Number(m);
    if (minutes > 59 || (sec !== undefined && Number(sec) > 59)) return undefined;
    if (meridiem) {
      if (hours < 1 || hours > 12) return undefined;
      const pm = meridiem.toLowerCase() === 'pm';
      hours = pm ? (hours % 12) + 12 : hours % 12;
    } else if (hours > 23) return undefined;
    return hours * 3600 + minutes * 60 + (sec === undefined ? 0 : Number(sec));
  }

  const fraction = Number(text);
  if (Number.isFinite(fraction) && fraction >= 0 && fraction < 1) {
    return dayFractionToSeconds(fraction);
  }
  return undefined;
}

function readDate(cell: string, format: 'auto' | 'excel-serial' | 'iso'): Date | undefined {
  const serial = Number(cell);
  const looksLikeSerial = Number.isFinite(serial) && serial > 1 && serial < 100_000;

  if (format === 'excel-serial' || (format === 'auto' && looksLikeSerial)) {
    if (!looksLikeSerial) return undefined;
    return excelSerialToUtcDate(serial);
  }

  // ISO only, and anchored to UTC so the result is a wall clock rather than
  // something that shifts with the machine's timezone.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(cell.trim());
  if (!iso) return undefined;
  const [, y, m, d] = iso;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1) return undefined;
  return date;
}

function readDepthAndDuration(obs: DiveObservation, row: Row, mapping: ColumnMapping): void {
  const depthFt = numberFor(row, mapping, 'maxDepthFt');
  const depthM = numberFor(row, mapping, 'maxDepthM');
  const depth = depthM ?? (depthFt === undefined ? undefined : feetToMetres(depthFt));
  const checkedDepth = checkRange('maxDepthM', depth);
  obs.issues.push(...checkedDepth.issues);
  if (checkedDepth.value !== undefined) obs.maxDepthM = checkedDepth.value;

  // `Dive Time` is a day fraction like the start time; `Duration` is minutes.
  const durationDays = numberFor(row, mapping, 'durationDays');
  const durationMinutes = numberFor(row, mapping, 'durationMinutes');
  const seconds =
    durationDays !== undefined && durationDays >= 0 && durationDays < 1
      ? dayFractionToSeconds(durationDays)
      : durationMinutes !== undefined
        ? Math.round(durationMinutes * 60)
        : undefined;
  const checkedDuration = checkRange('durationS', seconds);
  obs.issues.push(...checkedDuration.issues);
  if (checkedDuration.value !== undefined) obs.durationS = checkedDuration.value;
}

function readTemperatures(obs: DiveObservation, row: Row, mapping: ColumnMapping): void {
  const pairs = [
    ['airTempC', 'airTempF', 'airTempC'],
    ['waterTempC', 'waterTempF', 'waterTempMinC'],
  ] as const;

  for (const [celsiusField, fahrenheitField, target] of pairs) {
    const c = numberFor(row, mapping, celsiusField);
    const f = numberFor(row, mapping, fahrenheitField);
    const value = c ?? (f === undefined ? undefined : fahrenheitToCelsius(f));
    const checked = checkRange(target, value);
    obs.issues.push(...checked.issues);
    if (checked.value !== undefined) obs[target] = checked.value;
  }

  const visFt = numberFor(row, mapping, 'visibilityFt');
  const visM = numberFor(row, mapping, 'visibilityM');
  const vis = visM ?? (visFt === undefined ? undefined : feetToMetres(visFt));
  const checkedVis = checkRange('visibilityM', vis);
  obs.issues.push(...checkedVis.issues);
  if (checkedVis.value !== undefined) obs.visibilityM = checkedVis.value;
}

function readSiteAndTags(obs: DiveObservation, row: Row, mapping: ColumnMapping): void {
  const name = cellFor(row, mapping, 'siteName');
  const region = cellFor(row, mapping, 'region');
  if (name !== undefined || region !== undefined) {
    obs.site = {
      ...(name === undefined ? {} : { name }),
      ...(region === undefined ? {} : { regionHint: region }),
    };
  }

  // Quote-aware: the site `1,000 Steps` proves why this is not `split(',')`.
  const tags = cellFor(row, mapping, 'tags');
  if (tags !== undefined) obs.tags = splitValues(tags);

  const water = cellFor(row, mapping, 'waterType')?.toLowerCase();
  if (water !== undefined) {
    const match = WATER_TYPES.find((t) => water.startsWith(t));
    if (match) obs.waterType = match as WaterType;
    else {
      obs.issues.push(
        issue(
          'info',
          'unknown_water_type',
          `Water type "${water}" was not recognized.`,
          'waterType',
        ),
      );
    }
  }
}

function readGasAndGear(obs: DiveObservation, row: Row, mapping: ColumnMapping): void {
  const ean = numberFor(row, mapping, 'eanPercent');
  const label = cellFor(row, mapping, 'gasLabel');
  if (ean !== undefined) {
    obs.gases = [{ o2Fraction: percentToFraction(ean), ...(label === undefined ? {} : { label }) }];
  } else if (label !== undefined) {
    // `Air` is a mix with a known composition; anything else is a name we keep
    // without pretending to know its oxygen fraction.
    if (/^air$/i.test(label)) obs.gases = [{ o2Fraction: 0.21, label }];
    else
      obs.gases = [{ o2Fraction: Number.NaN, label }].filter((g) => Number.isFinite(g.o2Fraction));
  }

  const weightLb = numberFor(row, mapping, 'weightLb');
  const weightKg = numberFor(row, mapping, 'weightKg');
  const weight = weightKg ?? (weightLb === undefined ? undefined : poundsToKilograms(weightLb));
  const checked = checkRange('weightKg', weight);
  obs.issues.push(...checked.issues);
  if (checked.value !== undefined) obs.weightKg = checked.value;

  // Kept as written. Parsing `Full Wet Suit (5mil Rental), Boots (5mil Rental)`
  // into structured gear is worth doing, but the raw string is what survives a
  // parser that gets it wrong.
  const gear = cellFor(row, mapping, 'gear');
  if (gear !== undefined) obs.gear = { raw: gear };
}

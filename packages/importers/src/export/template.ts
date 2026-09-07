import { buildWorkbook } from './xlsx.ts';
import { IMPORT_FIELDS, type ImportField } from '../tabular/mapping.ts';

/**
 * The blank spreadsheet a diver starts from.
 *
 * "Any column layout" is true and is not much help when the page is empty. A
 * template turns the first import from a small research task into filling in a
 * sheet — and, because the diver almost certainly has some dives in a
 * spreadsheet already, into knowing what to rename.
 *
 * **Generated from `IMPORT_FIELDS`, not written out by hand.** A template that
 * is maintained separately from the mapping drifts the first time a column is
 * renamed, and then the file this product hands people is the one file it
 * cannot read. `template.test.ts` asserts every heading here maps to a field
 * and that the whole thing imports with nothing unmapped.
 */

export type UnitSystem = 'metric' | 'imperial';

/**
 * Columns, in the order a diver fills them in: what and when, then how deep
 * and how long, then conditions, then where, then the free text at the end.
 *
 * Deliberately not every field. `Dive Time` as a day fraction and the depth
 * columns in the other unit system both map, but nobody typing a fresh sheet
 * wants either — the template is the shape we would like files to arrive in,
 * not a catalogue of what is tolerated.
 */
type TemplateColumn = {
  /** The heading. Must map, and the test enforces that. */
  header: (units: UnitSystem) => string;
  field: ImportField | ((units: UnitSystem) => ImportField);
  /** What goes in the one example row. */
  example: (units: UnitSystem) => string;
  /** Shown under the heading in the workbook's notes sheet. */
  hint: string;
};

const COLUMNS: readonly TemplateColumn[] = [
  {
    header: () => 'Dive Number',
    field: 'diveNumber',
    example: () => '1',
    hint: 'Optional. Left blank, dives are numbered in date order on import.',
  },
  {
    header: () => 'Date',
    field: 'date',
    example: () => '2026-01-15',
    hint: 'Year-month-day. A date Excel formats as a date works too.',
  },
  {
    header: () => 'Time In',
    field: 'timeIn',
    example: () => '09:53',
    hint: 'The time you entered the water, as a 24-hour clock. Blank means midnight.',
  },
  {
    header: () => 'Duration (minutes)',
    field: 'durationMinutes',
    example: () => '46',
    hint: 'Whole minutes underwater.',
  },
  {
    header: (u) => (u === 'metric' ? 'Max Depth (m)' : 'Max Depth (ft)'),
    field: (u) => (u === 'metric' ? 'maxDepthM' : 'maxDepthFt'),
    example: (u) => (u === 'metric' ? '14.1' : '46'),
    hint: 'The deepest point of the dive.',
  },
  {
    header: (u) => (u === 'metric' ? 'Water Temperature (C)' : 'Water Temperature (F)'),
    field: (u) => (u === 'metric' ? 'waterTempC' : 'waterTempF'),
    example: (u) => (u === 'metric' ? '26.5' : '80'),
    hint: 'The coldest water temperature you saw.',
  },
  {
    header: (u) => (u === 'metric' ? 'Air Temperature (C)' : 'Air Temperature (F)'),
    field: (u) => (u === 'metric' ? 'airTempC' : 'airTempF'),
    example: (u) => (u === 'metric' ? '24' : '75'),
    hint: 'Optional.',
  },
  {
    header: (u) => (u === 'metric' ? 'Visibility (m)' : 'Visibility (ft)'),
    field: (u) => (u === 'metric' ? 'visibilityM' : 'visibilityFt'),
    example: (u) => (u === 'metric' ? '15' : '50'),
    hint: 'Optional.',
  },
  {
    header: () => 'Location',
    field: 'region',
    example: () => 'Example Bay',
    hint: 'The island, country or area. Used to group sites on the map.',
  },
  {
    header: () => 'Dive Site',
    field: 'siteName',
    // Deliberately not a real place. An example row with a plausible site and
    // a plausible date is one the matcher will offer to merge with somebody's
    // actual dive — which it did, the first time this was tested end to end.
    example: () => 'Example Reef',
    hint: 'The name of the site. Spelling it differently across rows is fine — matching is fuzzy.',
  },
  {
    header: () => 'Water Type',
    field: 'waterType',
    example: () => 'Salt',
    hint: 'Salt, Fresh or Brackish.',
  },
  {
    header: () => 'Dive Type',
    field: 'tags',
    example: () => 'Shore, Night',
    hint: 'Separate several with commas: Shore, Boat, Drift, Night, Wreck, Wall, Dock.',
  },
  {
    header: () => 'Gas',
    field: 'gasLabel',
    example: () => 'EAN',
    hint: 'Air, EAN (nitrox), or a trimix label.',
  },
  {
    header: () => 'EAN %',
    field: 'eanPercent',
    example: () => '32',
    hint: 'Oxygen percentage, for nitrox. Blank for air.',
  },
  {
    header: (u) => (u === 'metric' ? 'Weight (kg)' : 'Weight (lbs)'),
    field: (u) => (u === 'metric' ? 'weightKg' : 'weightLb'),
    example: (u) => (u === 'metric' ? '6.4' : '14'),
    hint: 'How much lead you carried.',
  },
  {
    header: () => 'Equipment',
    field: 'gear',
    example: () => 'Full Wet Suit, Boots',
    hint: 'Separate several with commas.',
  },
  {
    header: () => 'Buddy',
    field: 'buddies',
    example: () => 'Example Buddy',
    hint: 'Separate several with commas.',
  },
  {
    header: () => 'Rating',
    field: 'rating',
    example: () => '5',
    hint: 'One to five.',
  },
  {
    header: () => 'Notes',
    field: 'notes',
    example: () => 'EXAMPLE ROW — delete this before importing, or skip it on the review screen.',
    hint: 'Anything you want to remember. Never shown to staff and never shared by default.',
  },
];

export const templateHeaders = (units: UnitSystem): string[] =>
  COLUMNS.map((column) => column.header(units));

/** Which field each heading is expected to reach. Used by the test, not at runtime. */
export const templateFields = (units: UnitSystem): ImportField[] =>
  COLUMNS.map((column) =>
    typeof column.field === 'function' ? column.field(units) : column.field,
  );

export const templateExampleRow = (units: UnitSystem): string[] =>
  COLUMNS.map((column) => column.example(units));

/** Every field the template deliberately leaves out, and why, for the docs. */
export const templateOmits = (units: UnitSystem): ImportField[] => {
  const covered = new Set<ImportField>(templateFields(units));
  return IMPORT_FIELDS.filter((field) => !covered.has(field));
};

/**
 * The example row is a real row, not a comment.
 *
 * No spreadsheet format has comments that survive a round trip, so the choice
 * is between an example that imports and no example at all — and a blank sheet
 * of headings leaves the diver guessing at the date format, which is the one
 * thing they most need to see. It says what it is, in the column most likely
 * to be read, and the review screen means it can never become a dive without
 * being looked at first.
 */
export function templateCsv(units: UnitSystem): string {
  const escape = (cell: string): string =>
    /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  return [templateHeaders(units), templateExampleRow(units)]
    .map((row) => row.map(escape).join(','))
    .join('\r\n');
}

export function templateXlsx(units: UnitSystem): Uint8Array {
  return buildWorkbook([
    { name: 'Dives', rows: [templateHeaders(units), templateExampleRow(units)] },
    // Second, and with no heading row that maps to anything, so the reader
    // walks past it to the sheet above — the same rule that skips the "Read
    // me" tab in a workbook somebody built themselves.
    {
      name: 'About these columns',
      rows: [
        ['MyDiveLog import template'],
        [],
        ['Fill in the "Dives" sheet. Every column is optional except the date.'],
        ['Delete the example row, or skip it on the review screen.'],
        ['Columns are matched by name, so renaming one is fine as long as it still reads clearly.'],
        [],
        ...COLUMNS.map((column) => [column.header(units), column.hint]),
      ],
    },
  ]);
}

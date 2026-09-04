import { celsiusToFahrenheit, metresToFeet } from '@mydivelog/domain';
import type { ExportableDive, Logbook } from './types.ts';

/**
 * CSV export — a flat summary, one row per dive.
 *
 * There are a great many spreadsheet people, and one of them seeded this
 * project. The columns deliberately mirror the shape of that workbook, so an
 * export can be opened in the tool the data came from and still make sense.
 */

export type CsvExportOptions = {
  /** Divers who logged in feet want it back in feet. */
  units?: 'metric' | 'imperial';
};

const HEADERS_METRIC = [
  'Dive Number',
  'Date',
  'Time In',
  'Duration (min)',
  'Max Depth (m)',
  'Air Temperature (C)',
  'Water Temperature (C)',
  'Visibility (m)',
  'Location',
  'Dive Site',
  'Latitude',
  'Longitude',
  'Water Type',
  'Dive Type',
  'EAN %',
  'Equipment',
  'Weight (kg)',
  'Buddies',
  'Rating',
  'Notes',
] as const;

const HEADERS_IMPERIAL = HEADERS_METRIC.map((h) =>
  h.replace('(m)', '(ft)').replace('(C)', '(F)').replace('(kg)', '(lbs)'),
);

export function exportCsv(logbook: Logbook, options: CsvExportOptions = {}): string {
  const imperial = options.units === 'imperial';
  const headers = imperial ? HEADERS_IMPERIAL : HEADERS_METRIC;
  const rows = logbook.dives.map((dive) => row(dive, imperial));
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

function row(dive: ExportableDive, imperial: boolean): (string | number | undefined)[] {
  const depth = convert(dive.maxDepthM, imperial, metresToFeet);
  const vis = convert(dive.visibilityM, imperial, metresToFeet);
  const airT = convert(dive.airTempC, imperial, celsiusToFahrenheit);
  const waterT = convert(dive.waterTempMinC, imperial, celsiusToFahrenheit);
  const weight = convert(dive.weightKg, imperial, (kg) => kg / 0.45359237);

  return [
    dive.diveNumber,
    dive.startTimeLocal?.toISOString().slice(0, 10),
    dive.startTimeLocal?.toISOString().slice(11, 16),
    dive.durationS === undefined ? undefined : Math.round(dive.durationS / 60),
    depth,
    airT,
    waterT,
    vis,
    dive.site?.regionHint,
    dive.site?.name,
    dive.site?.lat,
    dive.site?.lon,
    dive.waterType,
    dive.tags?.join(', '),
    dive.gases?.[0] === undefined ? undefined : Math.round(dive.gases[0].o2Fraction * 100),
    dive.gear,
    weight,
    dive.buddies?.join(', '),
    dive.rating,
    dive.notes,
  ];
}

const convert = (
  value: number | undefined,
  imperial: boolean,
  to: (v: number) => number,
): number | undefined => (value === undefined ? undefined : round(imperial ? to(value) : value));

const round = (value: number): number => Number(value.toFixed(4));

/**
 * Quotes anything that would otherwise break the row apart.
 *
 * The site `1,000 Steps` is the reason. Exporting it unquoted produces a file
 * this project's own importer would read as two columns — and would then
 * happily create a site called `000 Steps`.
 */
function cell(value: string | number | undefined): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

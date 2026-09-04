import { issue, type Issue } from './observation.ts';

/**
 * Sentinel stripping — deciding which values in a file mean "absent".
 *
 * This is unavoidably per-format, manual work, and it is where import quality
 * actually lives. The instructive case is the seed UDDF's `leadquantity`, which
 * is `0.0` on all 96 dives while the same diver's spreadsheet records 16–24 lbs.
 * The watch has no way to know how much lead you wore, so it writes zero.
 *
 * Import that `0.0` as a measurement and it does not merely add a wrong number:
 * it gives a worthless value the standing to out-rank a real one during merge,
 * because the merge rules quite reasonably prefer a value to no value. One
 * unfiltered sentinel silently destroys a correct field on 96 dives.
 */

/** Text a human writes to mean "nothing here". Compared case-insensitively. */
export const NULL_TOKENS = ['', '-', '--', '?', 'n/a', 'na', 'none', 'null', 'unknown'] as const;

export function isNullToken(value: string, tokens: readonly string[] = NULL_TOKENS): boolean {
  return tokens.includes(value.trim().toLowerCase());
}

/**
 * Normalizes a spreadsheet cell to a string or `undefined`.
 * `N/A` appears in 40+ rows of the seed workbook's site column.
 */
export function cleanText(
  value: unknown,
  tokens: readonly string[] = NULL_TOKENS,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return isNullToken(text, tokens) ? undefined : text;
}

export function cleanNumber(
  value: unknown,
  tokens: readonly string[] = NULL_TOKENS,
): number | undefined {
  const text = cleanText(value, tokens);
  if (text === undefined) return undefined;
  // Thousands separators are common in hand-kept sheets.
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A value a format writes unconditionally, whether or not it measured anything.
 * Dropped before the value can reach merge.
 */
export type SentinelRule = {
  field: string;
  /** True when this value should be treated as absent. */
  matches: (value: number) => boolean;
  reason: string;
};

/**
 * Physically impossible readings. Kept separate from format sentinels because
 * these are worth *reporting* — a value outside these bounds means either the
 * file is damaged or the parser misread a unit, and both deserve a look.
 */
export type RangeRule = {
  field: string;
  min: number;
  max: number;
  unit: string;
};

export const RANGE_RULES: readonly RangeRule[] = [
  // The seed UDDF reports site altitudes from -196 m to +4.59 m. A negative
  // altitude at a sea-level dive site is the watch's barometer drifting, so
  // altitude must never be used to infer an altitude dive without bounds.
  //
  // -50 m rather than -430 m deliberately excludes the Dead Sea, the only
  // dive site on earth that would qualify. Losing an altitude reading there
  // costs one seldom-visited site its altitude-dive classification; admitting
  // barometric noise costs every dive in an export like this one.
  { field: 'site.altitudeM', min: -50, max: 6000, unit: 'm' },
  { field: 'maxDepthM', min: 0, max: 350, unit: 'm' },
  { field: 'avgDepthM', min: 0, max: 350, unit: 'm' },
  { field: 'durationS', min: 0, max: 86_400, unit: 's' },
  { field: 'waterTempMinC', min: -2, max: 45, unit: '°C' },
  { field: 'airTempC', min: -60, max: 60, unit: '°C' },
  { field: 'weightKg', min: 0, max: 60, unit: 'kg' },
  { field: 'visibilityM', min: 0, max: 100, unit: 'm' },
  { field: 'rating', min: 0, max: 5, unit: '' },
];

export type BoundsCheck = { value?: number; issues: Issue[] };

/** Drops a reading that cannot be real, and says so. */
export function checkRange(field: string, value: number | undefined): BoundsCheck {
  if (value === undefined) return { issues: [] };
  const rule = RANGE_RULES.find((r) => r.field === field);
  if (!rule) return { value, issues: [] };
  if (!Number.isFinite(value)) {
    return {
      issues: [issue('warning', 'not_a_number', `${field} was not a number; dropped.`, field)],
    };
  }
  if (value < rule.min || value > rule.max) {
    return {
      issues: [
        issue(
          'warning',
          'out_of_range',
          `${field} of ${value}${rule.unit} is outside the plausible range ` +
            `${rule.min}–${rule.max}${rule.unit}; dropped.`,
          field,
        ),
      ],
    };
  }
  return { value, issues: [] };
}

/**
 * Sentinels for the Oceanic+ UDDF export.
 *
 * `leadquantity` is the whole reason this mechanism exists: it is 0.0 on every
 * dive in the file. Zero lead is not a dive anyone takes, so a format that
 * writes it on all 96 records is declaring "unset", not measuring.
 */
export const OCEANIC_UDDF_SENTINELS: readonly SentinelRule[] = [
  {
    field: 'weightKg',
    matches: (v) => v === 0,
    reason: 'This export writes leadquantity 0.0 on every dive, so it means unset, not zero lead.',
  },
];

export function applySentinels(
  field: string,
  value: number | undefined,
  rules: readonly SentinelRule[],
): { value?: number; issues: Issue[] } {
  if (value === undefined) return { issues: [] };
  const rule = rules.find((r) => r.field === field && r.matches(value));
  if (!rule) return { value, issues: [] };
  // Deliberately an info, not a warning: this is the importer working
  // correctly, not something the diver needs to act on.
  return { issues: [issue('info', 'sentinel_dropped', rule.reason, field)] };
}

/**
 * A dive computer names a site with its own opaque id — the seed file's sites
 * are all `site_69ab7a96dce6e40c7d3abe65`, id and name identical. The watch
 * knows where you were and has no idea what the place is called.
 *
 * The coordinates are real and worth keeping; the name is not a name.
 */
export function cleanSiteName(name: string | undefined, id?: string): string | undefined {
  if (name === undefined) return undefined;
  const trimmed = name.trim();
  if (trimmed === '') return undefined;
  if (id !== undefined && trimmed === id.trim()) return undefined;
  // Catches the same pattern when a parser did not have the id to hand.
  if (/^site[_-][0-9a-f]{8,}$/i.test(trimmed)) return undefined;
  return trimmed;
}

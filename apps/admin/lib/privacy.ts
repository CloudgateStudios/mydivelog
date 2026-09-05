/**
 * What staff may and may not see.
 *
 * Separate from `db.ts` so it carries no database connection: these constants
 * are the mechanism behind an acceptance criterion, and a rule that can only
 * be read by something holding a Postgres pool is a rule that is awkward to
 * test and easy to drift from.
 */

/**
 * Fields of a dive that staff may see.
 *
 * Notes are deliberately absent. `docs/11-roadmap.md` makes "staff cannot see
 * dive notes anywhere in the UI" an acceptance criterion for this phase — a
 * dive note is the most personal thing in a logbook, who someone dived with
 * and what went wrong and what frightened them, and none of it is needed to
 * debug an import.
 *
 * Adding `notes` or `privateNotes` here is a decision, not an oversight, and
 * `privacy.test.ts` fails if either appears.
 */
export const DIVE_SELECT = {
  id: true,
  userId: true,
  diveNumber: true,
  startTimeUtc: true,
  startTimeLocal: true,
  tzOffsetMinutes: true,
  durationS: true,
  maxDepthM: true,
  avgDepthM: true,
  waterTempMinC: true,
  airTempC: true,
  visibilityM: true,
  weightKg: true,
  waterType: true,
  diveMode: true,
  siteId: true,
  rating: true,
  hasProfile: true,
  hasContestedFields: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  version: true,
} as const;

/**
 * Provenance field paths whose *value* is withheld.
 *
 * Provenance stores what each source asserted, so a `notes` row carries the
 * note itself. Rendering provenance unfiltered would leak exactly what
 * DIVE_SELECT is written to prevent.
 */
export const WITHHELD_FIELD_PATHS = new Set(['notes', 'privateNotes']);

export function redactProvenanceValue(fieldPath: string, value: unknown): unknown {
  return WITHHELD_FIELD_PATHS.has(fieldPath) ? '[withheld]' : value;
}

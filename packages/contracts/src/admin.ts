import { z } from 'zod';
import { Celsius, IsoDateTime, Kilograms, Metres, Seconds, Uuid } from './common.ts';
import { DiveMode, MAX_DEPTH_M, MAX_DURATION_S, WaterType } from './dives.ts';

/**
 * The staff surface.
 *
 * Everything here changes data that belongs to someone else, which makes it
 * different in kind from the rest of this package. Three rules follow from
 * that, and they are the reason these schemas are not simply the user-facing
 * ones with a different guard:
 *
 * 1. **A reason travels with every change.** `StaffScope` in @mydivelog/db
 *    cannot be constructed without one, so the reason is not advisory — an
 *    unexplained staff mutation is a type error, not a policy violation.
 * 2. **Destructive actions demand a typed reason; edits accept a default.**
 *    Requiring free text to rename a site produces a database full of "asdf".
 *    Requiring it to delete an account produces the sentence someone will want
 *    to read in six months. See `Reason` and `RequiredReason` below.
 * 3. **Notes are absent.** `docs/11-roadmap.md` makes "staff cannot see dive
 *    notes anywhere in the UI" an acceptance criterion; a schema that lets
 *    staff *write* notes they cannot read is a worse version of the same
 *    problem. Their absence from `AdminUpdateDive` is deliberate and
 *    `contracts.test.ts` fails if either field appears.
 */

/** Why. Free text, kept short enough to read in a table. */
const REASON = z.string().trim().min(3).max(200);

/**
 * Optional on edits. The API substitutes the action name when it is omitted,
 * so the audit row is never empty — it just says "renamed a site" rather than
 * a sentence a human wrote.
 */
export const Reason = REASON.optional();

/** Required on anything that removes data or cuts off access. */
export const RequiredReason = REASON;

/** The body of every delete, because a delete always needs explaining. */
export const StaffDelete = z.object({ reason: RequiredReason });
export type StaffDelete = z.infer<typeof StaffDelete>;

// ---------------------------------------------------------------------------
// Sites. Shared reference data, and the most import-polluted table there is.
// ---------------------------------------------------------------------------

const adminSiteFields = {
  name: z.string().trim().min(1).max(160).optional(),
  // Latitude and longitude move together or not at all. A site carrying one
  // coordinate is not a location, and the pair is validated as a pair below.
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  maxDepthM: Metres.min(0).max(MAX_DEPTH_M).nullish(),
  typicalEntry: z.enum(['shore', 'boat', 'dock']).nullish(),
  description: z.string().max(4000).nullish(),
  /** Promotion out of one diver's private list into the shared database. */
  isPublic: z.boolean().optional(),
  reason: Reason,
};

export const AdminUpdateSite = z
  .object(adminSiteFields)
  .refine(
    (v) =>
      (v.latitude === undefined || v.latitude === null) ===
      (v.longitude === undefined || v.longitude === null),
    {
      // Half a coordinate is not a location. Accepting one and defaulting the
      // other puts the site in the Gulf of Guinea, which is where every
      // zero-defaulted coordinate on every map ends up.
      error: 'Latitude and longitude have to be set or cleared together.',
      path: ['latitude'],
    },
  );
export type AdminUpdateSite = z.infer<typeof AdminUpdateSite>;

/**
 * Another name the same place goes by. Aliases are how "1,000 Steps" and
 * "Thousand Steps" stop being two sites, so adding one by hand is the manual
 * version of what the importer does automatically.
 */
export const AddSiteAlias = z.object({
  name: z.string().trim().min(1).max(160),
  reason: Reason,
});
export type AddSiteAlias = z.infer<typeof AddSiteAlias>;

/**
 * Fold one site into another.
 *
 * Every dive, and every alias, moves to the target; the source's own name is
 * kept as an alias of the target so the name a diver typed still finds the
 * place. The source is then soft-deleted. This is the single most useful
 * moderation action and the one with the most reach, which is why it takes a
 * required reason and its own endpoint rather than being a shape of PATCH.
 */
export const MergeSites = z
  .object({
    sourceId: Uuid,
    targetId: Uuid,
    reason: RequiredReason,
  })
  .refine((v) => v.sourceId !== v.targetId, {
    // Not caught, this soft-deletes the site it just moved everything into.
    error: 'A site cannot be merged into itself.',
    path: ['sourceId'],
  });
export type MergeSites = z.infer<typeof MergeSites>;

// ---------------------------------------------------------------------------
// Tags.
// ---------------------------------------------------------------------------

export const TAG_CATEGORIES = ['entry', 'condition', 'environment', 'activity'] as const;
export const TagCategory = z.enum(TAG_CATEGORIES);

export const AdminUpdateTag = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  category: TagCategory.optional(),
  /**
   * Promotion into the seeded taxonomy. A user tag many people have written is
   * a tag the taxonomy is missing; promoting it stops the next diver minting
   * their own copy. Demotion is allowed too, and detaches nothing.
   */
  isSystem: z.boolean().optional(),
  reason: Reason,
});
export type AdminUpdateTag = z.infer<typeof AdminUpdateTag>;

// ---------------------------------------------------------------------------
// Users. Account lifecycle only — never their diving.
// ---------------------------------------------------------------------------

export const ADMIN_USER_STATUSES = ['active', 'suspended'] as const;

/**
 * `deleted` is absent on purpose: it is not a status someone is moved to, it
 * is what DELETE does, and offering both makes two paths to the same state
 * that can disagree.
 */
export const AdminUpdateUser = z.object({
  status: z.enum(ADMIN_USER_STATUSES),
  reason: RequiredReason,
});
export type AdminUpdateUser = z.infer<typeof AdminUpdateUser>;

// ---------------------------------------------------------------------------
// Dives. Someone else's logbook — the narrowest surface here.
// ---------------------------------------------------------------------------

/**
 * What staff may correct on a dive.
 *
 * This is the subset an import can get wrong: times, offsets, the measured
 * numbers, and which site it happened at. Notes, private notes, ratings, trips,
 * gear and buddies are all absent — they are things the diver wrote rather than
 * things a parser produced, and there is no support question whose answer is
 * staff editing them.
 */
export const AdminUpdateDive = z.object({
  diveNumber: z.number().int().positive().optional(),
  startTimeUtc: IsoDateTime.optional(),
  startTimeLocal: z.iso.datetime({ local: true }).optional(),
  tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  durationS: Seconds.min(0).max(MAX_DURATION_S).nullish(),
  maxDepthM: Metres.min(0).max(MAX_DEPTH_M).nullish(),
  avgDepthM: Metres.min(0).max(MAX_DEPTH_M).nullish(),
  waterTempMinC: Celsius.min(-5).max(45).nullish(),
  airTempC: Celsius.min(-60).max(60).nullish(),
  visibilityM: Metres.min(0).max(200).nullish(),
  weightKg: Kilograms.max(60).nullish(),
  waterType: WaterType.nullish(),
  diveMode: DiveMode.nullish(),
  siteId: Uuid.nullish(),
  reason: Reason,
});
export type AdminUpdateDive = z.infer<typeof AdminUpdateDive>;

// ---------------------------------------------------------------------------
// The audit log itself.
// ---------------------------------------------------------------------------

export const AuditEvent = z.object({
  id: Uuid,
  actorId: Uuid.nullable(),
  actorEmail: z.string().nullable(),
  actorKind: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  actorId: Uuid.optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

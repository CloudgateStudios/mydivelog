import { z } from 'zod';
import { Celsius, IsoDateTime, Kilograms, Metres, PageQuery, Seconds, Uuid } from './common.ts';

export const WaterType = z.enum(['fresh', 'salt', 'brackish']);
export const DiveMode = z.enum(['opencircuit', 'ccr', 'scr', 'freedive', 'snorkel']);

/**
 * Bounds are sanity limits, not dive guidance. They exist to reject data entry
 * mistakes and malformed imports, and are deliberately wider than any dive a
 * person should be doing — see docs/10-security-privacy.md § Liability.
 */
export const MAX_DEPTH_M = 350;
export const MAX_DURATION_S = 60 * 60 * 24;

const diveFields = {
  diveNumber: z.number().int().positive().optional(),

  // Three time fields, always. A source's recorded offset can be wrong — the
  // sample UDDF writes "-00:04" meaning -04:00 — so the local time the diver
  // remembers is stored independently of any timezone derivation.
  startTimeUtc: IsoDateTime,
  // Deliberately timezone-less. This is the wall-clock time the diver
  // remembers; the offset is carried separately so a wrong source offset can be
  // corrected later without rewriting what was originally recorded.
  startTimeLocal: z.iso.datetime({ local: true }),
  tzOffsetMinutes: z.number().int().min(-840).max(840),
  tzName: z.string().max(64).nullish(),

  durationS: Seconds.min(0).max(MAX_DURATION_S).nullish(),
  maxDepthM: Metres.min(0).max(MAX_DEPTH_M).nullish(),
  avgDepthM: Metres.min(0).max(MAX_DEPTH_M).nullish(),

  waterTempMinC: Celsius.min(-5).max(45).nullish(),
  waterTempMaxC: Celsius.min(-5).max(45).nullish(),
  airTempC: Celsius.min(-60).max(60).nullish(),
  visibilityM: Metres.min(0).max(200).nullish(),
  weightKg: Kilograms.max(60).nullish(),

  waterType: WaterType.nullish(),
  diveMode: DiveMode.nullish(),
  altitudeM: Metres.min(-500).max(6000).nullish(),

  siteId: Uuid.nullish(),
  tripId: Uuid.nullish(),

  rating: z.number().int().min(1).max(5).nullish(),
  notes: z.string().max(20_000).nullish(),
  privateNotes: z.string().max(20_000).nullish(),
};

export const CreateDive = z
  .object(diveFields)
  .refine((d) => d.avgDepthM == null || d.maxDepthM == null || d.avgDepthM <= d.maxDepthM, {
    message: 'avgDepthM cannot exceed maxDepthM',
    path: ['avgDepthM'],
  });
export type CreateDive = z.infer<typeof CreateDive>;

/**
 * PATCH semantics: an omitted key is unchanged, an explicit null clears the
 * value. That distinction is why every optional field above is `nullish`
 * rather than `optional`.
 */
export const UpdateDive = z.object(diveFields).partial();
export type UpdateDive = z.infer<typeof UpdateDive>;

export const Dive = z.object({
  id: Uuid,
  ...diveFields,
  diveNumber: z.number().int().positive(),
  hasProfile: z.boolean(),
  hasContestedFields: z.boolean(),
  surfaceIntervalS: Seconds.nullable(),
  repetitionIndex: z.number().int().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: z.number().int(),
});
export type Dive = z.infer<typeof Dive>;

export const ListDivesQuery = PageQuery.extend({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  siteId: Uuid.optional(),
  tripId: Uuid.optional(),
  hasProfile: z.stringbool().optional(),
  minDepthM: z.coerce.number().min(0).max(MAX_DEPTH_M).optional(),
  maxDepthM: z.coerce.number().min(0).max(MAX_DEPTH_M).optional(),
});
export type ListDivesQuery = z.infer<typeof ListDivesQuery>;

/** Renumbering is transactional and reports what it changed. */
export const RenumberDives = z.object({ startAt: z.number().int().min(1).default(1) });
export const RenumberResult = z.object({
  changed: z.number().int(),
  changes: z.array(z.object({ id: Uuid, from: z.number().int(), to: z.number().int() })),
});

export const LogSummary = z.object({
  diveCount: z.number().int(),
  totalBottomTimeS: Seconds,
  maxDepthM: Metres.nullable(),
  longestDiveS: Seconds.nullable(),
  averageDepthM: Metres.nullable(),
});

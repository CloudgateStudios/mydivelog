import { z } from 'zod';
import {
  Celsius,
  IsoDate,
  IsoDateTime,
  Kilograms,
  Metres,
  PageQuery,
  Seconds,
  Uuid,
} from './common.ts';

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

export const DiveSort = z.enum([
  'date_desc',
  'date_asc',
  'depth_desc',
  'duration_desc',
  'number_asc',
]);
export type DiveSort = z.infer<typeof DiveSort>;

/**
 * Depth bounds are metres, like every other payload in this package, even
 * though the diver typed feet. The conversion happens where the number is
 * typed, so a saved view and a shared link mean the same range to a diver who
 * logs in metres and one who logs in feet — the alternative is a URL whose
 * meaning depends on who opens it.
 */
export const ListDivesQuery = PageQuery.extend({
  // Dates, not timestamps: "dives in March" is a question about days, and it
  // is answered against the dive's *local* start time. `to` includes the whole
  // of its day — see divesDateRange.
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  siteId: Uuid.optional(),
  tripId: Uuid.optional(),
  hasProfile: z.stringbool().optional(),
  minDepthM: z.coerce.number().min(0).max(MAX_DEPTH_M).optional(),
  maxDepthM: z.coerce.number().min(0).max(MAX_DEPTH_M).optional(),
  // Repeatable: ?tag=wreck&tag=night narrows to dives carrying both.
  tag: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: DiveSort.default('date_desc'),
  // A second query, so it is asked for rather than assumed. See the repository.
  withTotal: z.stringbool().optional(),
});
export type ListDivesQuery = z.infer<typeof ListDivesQuery>;

/**
 * A `YYYY-MM-DD` filter as the wall-clock bounds it means.
 *
 * `to` runs to the last millisecond of its day: a diver who filters "to March
 * 31st" and loses that day's dives has been told the filter is broken, and
 * they are right. Built as a UTC instant because the column it is compared
 * against is `timestamp without time zone` holding wall clock, which the
 * driver reads and writes as UTC.
 */
export function divesDateRange(query: Pick<ListDivesQuery, 'from' | 'to'>): {
  from?: Date;
  to?: Date;
} {
  return {
    ...(query.from ? { from: new Date(`${query.from}T00:00:00.000Z`) } : {}),
    ...(query.to ? { to: new Date(`${query.to}T23:59:59.999Z`) } : {}),
  };
}

/**
 * What this diver can filter by, with counts.
 *
 * Only values that appear on one of their dives: a dropdown offering a site
 * they have never dived is a list of ways to reach an empty page.
 */
export const DiveFacets = z.object({
  sites: z.array(z.object({ id: Uuid, name: z.string(), count: z.number().int() })),
  tags: z.array(z.object({ slug: z.string(), name: z.string(), count: z.number().int() })),
  depthM: z.object({ min: Metres.nullable(), max: Metres.nullable() }),
  dates: z.object({ first: IsoDateTime.nullable(), last: IsoDateTime.nullable() }),
});
export type DiveFacets = z.infer<typeof DiveFacets>;

/**
 * A saved view is a name and a query string, not a row of filter columns.
 *
 * `query` is re-validated through ListDivesQuery on read, so a view saved
 * before a filter was removed still opens — with the filters that survive.
 */
export const SavedView = z.object({
  id: Uuid,
  name: z.string(),
  query: z.string(),
  position: z.number().int(),
  createdAt: IsoDateTime,
});
export type SavedView = z.infer<typeof SavedView>;

export const CreateSavedView = z.object({
  name: z.string().trim().min(1).max(60),
  query: z.string().max(2000),
});
export type CreateSavedView = z.infer<typeof CreateSavedView>;

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

/**
 * Bucket width for the depth histogram, in metres.
 *
 * The caller chooses because it is the one unit decision the display layer
 * cannot make afterwards: bucketing at 5 m and relabelling in feet gives
 * boundaries of 16.4 and 32.8 ft. A diver reading feet wants 10 ft buckets,
 * which is 3.048 m.
 */
export const StatsOverviewQuery = z.object({
  bucketM: z.coerce.number().positive().max(50).default(5),
});
export type StatsOverviewQuery = z.infer<typeof StatsOverviewQuery>;

export const StatsOverview = z.object({
  totals: LogSummary,
  byYear: z.array(
    z.object({ year: z.number().int(), dives: z.number().int(), bottomTimeS: Seconds }),
  ),
  byMonth: z.array(
    z.object({ month: z.number().int(), name: z.string(), dives: z.number().int() }),
  ),
  depthHistogram: z.array(z.object({ fromM: Metres, toM: Metres, dives: z.number().int() })),
  milestone: z.object({ at: z.number().int(), remaining: z.number().int() }).nullable(),
  streak: z.object({ days: z.number().int(), from: IsoDateTime, to: IsoDateTime }).nullable(),
  firstDive: IsoDateTime.nullable(),
  lastDive: IsoDateTime.nullable(),
});
export type StatsOverview = z.infer<typeof StatsOverview>;

/**
 * A site as this diver's own logbook knows it: their dive count there, and
 * the range they have seen. Sites they have never dived are not their sites.
 */
export const DiverSite = z.object({
  id: Uuid,
  name: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  regionName: z.string().nullable(),
  dives: z.number().int(),
  maxDepthM: Metres.nullable(),
  firstDive: IsoDateTime.nullable(),
  lastDive: IsoDateTime.nullable(),
});
export type DiverSite = z.infer<typeof DiverSite>;

/**
 * A dive with the context a detail view needs.
 *
 * `provenance` is the part that matters: every value any source asserted, and
 * which one the dive currently shows. It is what lets a diver ask "why does it
 * say 14.099 when I wrote 46 feet" and get an answer rather than a shrug.
 */
export const DiveProvenanceEntry = z.object({
  fieldPath: z.string(),
  value: z.unknown(),
  isSelected: z.boolean(),
  sourceKind: z.string(),
  sourceRef: z.string().nullish(),
  recordedAt: IsoDateTime,
});

export const DiveDetail = Dive.extend({
  site: z
    .object({
      id: Uuid,
      name: z.string(),
      latitude: z.number().nullish(),
      longitude: z.number().nullish(),
    })
    .nullish(),
  tags: z.array(z.object({ slug: z.string(), label: z.string() })).default([]),
  buddies: z.array(z.string()).default([]),
  /** Summary only. The samples are a separate request. */
  profile: z
    .object({
      sampleCount: z.number().int(),
      maxDepthM: z.number(),
      avgDepthM: z.number(),
      durationS: z.number().int(),
      minTempC: z.number().nullish(),
      maxTempC: z.number().nullish(),
      channels: z.array(z.string()),
    })
    .nullish(),
  sources: z
    .array(
      z.object({
        sourceKind: z.string(),
        sourceRef: z.string().nullish(),
        recordedAt: IsoDateTime,
      }),
    )
    .default([]),
  provenance: z.array(DiveProvenanceEntry).default([]),
});
export type DiveDetail = z.infer<typeof DiveDetail>;

/** The decoded depth profile, fetched on its own because it is large. */
export const DiveProfileSeries = z.object({
  timeS: z.array(z.number()),
  depthM: z.array(z.number()),
  tempC: z.array(z.number()).optional(),
  pressureBar: z.array(z.number()).optional(),
});
export type DiveProfileSeries = z.infer<typeof DiveProfileSeries>;

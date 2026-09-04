import type { ProfileSeries } from '@mydivelog/domain';

/**
 * A dive as an exporter sees it.
 *
 * Deliberately not the database row and not a `DiveObservation`. Export has to
 * work from either — a logbook read out of Postgres, or a pipeline result that
 * has not been committed — and neither should have to know about the other.
 */
export type ExportableDive = {
  /**
   * This logbook's own stable id for the dive.
   *
   * Carried so a re-import is decided by identity rather than re-scored. A
   * backup restored onto a logbook that still holds those dives has to be a
   * no-op, and matching cannot promise that: a dive with no depth and no time
   * of day scores below the merge threshold against its own twin, lands in
   * review, and duplicates.
   */
  ref?: string;
  diveNumber?: number;
  startTimeLocal?: Date;
  startTimeUtc?: Date;
  tzOffsetMinutes?: number;
  durationS?: number;
  maxDepthM?: number;
  avgDepthM?: number;
  site?: { name?: string; lat?: number; lon?: number; altitudeM?: number; regionHint?: string };
  tags?: string[];
  gases?: { o2Fraction: number; heFraction?: number; label?: string }[];
  buddies?: string[];
  gear?: string;
  waterTempMinC?: number;
  airTempC?: number;
  visibilityM?: number;
  weightKg?: number;
  waterType?: string;
  rating?: number;
  notes?: string;
  profile?: ProfileSeries;
  /** Which files asserted this dive. Carried so an export can be re-imported. */
  sources?: { sourceKind: string; sourceRef?: string; recordedAt?: Date }[];
};

export type Logbook = {
  dives: ExportableDive[];
};

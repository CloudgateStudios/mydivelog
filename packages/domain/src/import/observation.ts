import type { ProfileSeries } from '../profile/index.ts';

/**
 * The intermediate representation every importer produces.
 *
 * Adding a format means writing one function to this shape and nothing else.
 * Matching, merging and commit never see a format-specific type, which is what
 * keeps the number of formats from multiplying the engine's complexity.
 *
 * Two invariants, both learned from the seed files:
 *
 * - `raw` is never dropped. If a parser missed something, it can be recovered
 *   later without asking the diver to upload the file again.
 * - Absent means absent. A field the source did not provide is `undefined`,
 *   never `0` and never `''` — see `SENTINELS` for why that distinction is
 *   load-bearing rather than fussy.
 */
export type DiveObservation = {
  /** The source's own identifier, when it has one. Makes re-import idempotent. */
  sourceRef?: string;
  sourceKind: string;

  startTime: ObservedTime;
  durationS?: number;
  maxDepthM?: number;
  avgDepthM?: number;

  site?: ObservedSite;
  /** As the source wrote them, before any taxonomy matching. */
  tags?: string[];
  gases?: ObservedGas[];
  tanks?: ObservedTank[];
  gear?: { raw: string };
  buddies?: string[];

  waterTempMinC?: number;
  airTempC?: number;
  visibilityM?: number;
  weightKg?: number;
  waterType?: WaterType;
  diveMode?: string;
  rating?: number;
  notes?: string;
  diveNumber?: number;

  profile?: ProfileSeries;

  /** The source's untouched representation. Always kept. */
  raw: unknown;
  issues: Issue[];
  normalizations: Normalization[];
};

export const WATER_TYPES = ['fresh', 'salt', 'brackish'] as const;
export type WaterType = (typeof WATER_TYPES)[number];

/**
 * A dive's time, kept in all three forms a dive needs plus the string it came
 * from. The raw text survives because an offset repair has to be explainable
 * against what the file actually said, not against what we parsed it into.
 */
export type ObservedTime = {
  utc?: Date;
  /** Wall clock at the dive site, with no zone attached. */
  local?: Date;
  offsetMinutes?: number;
  raw: string;
  /** Set when the offset failed a semantic check — see `repairOffset`. */
  offsetSuspect?: boolean;
};

export type ObservedSite = {
  name?: string;
  lat?: number;
  lon?: number;
  altitudeM?: number;
  regionHint?: string;
};

export type ObservedGas = {
  o2Fraction: number;
  heFraction?: number;
  label?: string;
};

export type ObservedTank = {
  volumeL?: number;
  startBar?: number;
  endBar?: number;
  gasIndex?: number;
};

export const ISSUE_SEVERITIES = ['info', 'warning', 'error'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/**
 * Something wrong with one row. Never fatal for a batch: a file of 197 dives
 * with one unparseable date imports 196 dives and reports the one, rather than
 * failing whole and leaving the diver to find the bad row themselves.
 */
export type Issue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  field?: string;
};

/**
 * A value this pipeline changed, and why.
 *
 * Every normalization is surfaced in review. The seed UDDF writes its UTC
 * offset hours-into-the-minutes field, so importing it correctly means
 * rewriting all 96 timestamps — and a silent rewrite of someone's dive times
 * is indistinguishable from a bug that corrupts them.
 */
export type Normalization = {
  field: string;
  from: unknown;
  to: unknown;
  reason: string;
  confidence: NormalizationConfidence;
};

export const NORMALIZATION_CONFIDENCES = ['high', 'low'] as const;
export type NormalizationConfidence = (typeof NORMALIZATION_CONFIDENCES)[number];

export const issue = (
  severity: IssueSeverity,
  code: string,
  message: string,
  field?: string,
): Issue =>
  field === undefined ? { severity, code, message } : { severity, code, message, field };

export const normalization = (
  field: string,
  from: unknown,
  to: unknown,
  reason: string,
  confidence: NormalizationConfidence = 'high',
): Normalization => ({ field, from, to, reason, confidence });

/** A blank observation, so parsers can fill in only what their format carries. */
export const emptyObservation = (
  sourceKind: string,
  raw: unknown,
  rawTime = '',
): DiveObservation => ({
  sourceKind,
  startTime: { raw: rawTime },
  raw,
  issues: [],
  normalizations: [],
});

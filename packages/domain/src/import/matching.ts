import { distanceM, isValidCoordinate } from './geo.ts';
import type { DiveObservation } from './observation.ts';
import { nameSimilarity } from './similarity.ts';

/**
 * Matching — given a normalized observation, is this a dive we already have?
 *
 * This is where the product succeeds or fails. The two seed files describe
 * roughly 92-96 of the same physical dives in incompatible shapes. Get this
 * right and a diver ends up with one history richer than either file. Get it
 * wrong and they get 293 rows, ~96 of them duplicates, and they leave.
 */

/** An existing dive, reduced to what matching needs. */
export type MatchCandidate = {
  id: string;
  startTimeUtc?: Date;
  /** Wall clock at the site. The only time a spreadsheet actually records. */
  startTimeLocal?: Date;
  durationS?: number;
  maxDepthM?: number;
  site?: { name?: string; lat?: number; lon?: number };
  gases?: { o2Fraction: number }[];
  /** Source refs already attached, so an exact re-import is deterministic. */
  sourceRefs?: string[];
};

export const MATCH_DECISIONS = ['merge', 'ambiguous', 'create'] as const;
export type MatchDecision = (typeof MATCH_DECISIONS)[number];

export type MatchReason = {
  signal: string;
  weight: number;
  detail: string;
};

export type Match = {
  candidateId: string;
  score: number;
  reasons: MatchReason[];
};

export type MatchOutcome = {
  decision: MatchDecision;
  best?: Match;
  /** Every candidate that scored above the floor, best first. */
  considered: Match[];
  /** Why the decision was not the one the score alone implies. */
  note?: string;
};

// --- thresholds -------------------------------------------------------------

export const AUTO_MERGE_THRESHOLD = 0.8;
export const AMBIGUOUS_THRESHOLD = 0.45;

/**
 * A row whose offset failed its semantic check never auto-merges.
 *
 * The first attempt at this raised the threshold to 0.95 instead, which does
 * nothing: the weights sum past 1 and the score is clamped, so a dive agreeing
 * on time, depth, duration, site and gas scores exactly 1.0 and clears any
 * threshold below it. The strongest matches — the ones most worth stopping,
 * because they are about to write to a real dive — were the ones the raised
 * bar could not catch.
 *
 * A categorical rule is also the honest one. When the offset is unverifiable
 * we do not know what time the dive happened, and time of day is the only
 * thing separating five dives on one day in Bonaire. No amount of agreement on
 * depth and duration substitutes for that, because those five dives agree on
 * depth and duration too.
 */
export const SUSPECT_OFFSET_NEVER_AUTO_MERGES = true;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Deliberately wide: the timezone of an incoming record may itself be wrong. */
export const CANDIDATE_WINDOW_MS = 6 * HOUR;

/**
 * One percentage point of oxygen, plus room for binary floating point.
 *
 * Without the slack this signal never fires on the exact case it exists for.
 * The seed spreadsheet records EAN 32 and the computer sensed 0.33, and
 * `Math.abs(0.32 - 0.33)` is 0.010000000000000009 — just over a bare 0.01, so
 * every real gas agreement scored zero and nothing looked wrong.
 */
export const GAS_TOLERANCE = 0.0100001;

// --- time comparison --------------------------------------------------------

export const TIME_BASES = ['utc', 'local', 'none'] as const;
export type TimeBasis = (typeof TIME_BASES)[number];

export type TimeComparison = {
  basis: TimeBasis;
  /** Absolute difference in milliseconds, on whichever basis was used. */
  deltaMs?: number;
  sameLocalDate: boolean;
};

/**
 * Compares two dive times using the best basis both sides actually have.
 *
 * This matters more than it looks. The seed spreadsheet records a wall clock
 * and no zone — that is genuinely all the diver wrote down — while the UDDF
 * carries an offset. Comparing UTC would mean inventing a zone for the
 * spreadsheet, and inventing it from the server's timezone is how the same
 * pair of files match in Chicago and fail in UTC.
 *
 * Local wall clock is also the better key on its merits: both sources record
 * the time the diver saw on their watch. UTC is used only when both sides have
 * genuinely resolved one.
 */
export function compareTimes(
  observation: { utc?: Date; local?: Date },
  candidate: { startTimeUtc?: Date; startTimeLocal?: Date },
): TimeComparison {
  const localPair =
    observation.local && candidate.startTimeLocal
      ? ([observation.local, candidate.startTimeLocal] as const)
      : undefined;
  const utcPair =
    observation.utc && candidate.startTimeUtc
      ? ([observation.utc, candidate.startTimeUtc] as const)
      : undefined;

  // Local first: it is the only basis a spreadsheet can offer, and it is what
  // both sources are actually recording.
  const pair = localPair ?? utcPair;
  const basis: TimeBasis = localPair ? 'local' : utcPair ? 'utc' : 'none';
  if (!pair) return { basis, sameLocalDate: false };

  const [a, b] = pair;
  return {
    basis,
    deltaMs: Math.abs(a.getTime() - b.getTime()),
    sameLocalDate: sameUtcDate(a, b),
  };
}

const sameUtcDate = (a: Date, b: Date): boolean =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();

// --- scoring ----------------------------------------------------------------

/**
 * Scores one observation against one existing dive.
 *
 * Weights are additive and the total is clamped to 1. Every contribution
 * carries a human-readable reason, because a merge a diver cannot understand
 * is a merge they will not trust.
 */
export function scoreMatch(observation: DiveObservation, candidate: MatchCandidate): Match {
  const reasons: MatchReason[] = [];

  // An exact re-import is not a judgement call. Same source, same id, same
  // dive — this is what makes importing a file twice a no-op.
  if (
    observation.sourceRef !== undefined &&
    candidate.sourceRefs?.includes(observation.sourceRef)
  ) {
    return {
      candidateId: candidate.id,
      score: 1,
      reasons: [
        {
          signal: 'sourceRef',
          weight: 1,
          detail: `This dive already carries source id ${observation.sourceRef}.`,
        },
      ],
    };
  }

  const add = (signal: string, weight: number, detail: string): void => {
    reasons.push({ signal, weight, detail });
  };

  const time = compareTimes(observation.startTime, candidate);
  if (time.deltaMs !== undefined) {
    const minutes = time.deltaMs / MINUTE;
    const basis = time.basis === 'local' ? 'local time' : 'UTC';
    if (minutes <= 5) {
      add('startTime', 0.45, `Start times are within ${minutes.toFixed(0)} min (${basis}).`);
    } else if (minutes <= 90 && time.sameLocalDate) {
      add(
        'startTimeLoose',
        0.25,
        `Start times are ${minutes.toFixed(0)} min apart on the same day (${basis}).`,
      );
    } else if (time.sameLocalDate) {
      add('sameDate', 0.1, 'Same date, but the times are far apart.');
    }
  }

  if (observation.maxDepthM !== undefined && candidate.maxDepthM !== undefined) {
    const diff = Math.abs(observation.maxDepthM - candidate.maxDepthM);
    const tolerance = Math.max(1, candidate.maxDepthM * 0.05);
    if (diff <= tolerance) {
      // 46 ft rounded by a human against 14.099 m read by a computer.
      add('maxDepth', 0.2, `Max depths agree within ${diff.toFixed(2)} m.`);
    }
  }

  if (observation.durationS !== undefined && candidate.durationS !== undefined) {
    const diff = Math.abs(observation.durationS - candidate.durationS);
    const tolerance = Math.max(180, candidate.durationS * 0.1);
    if (diff <= tolerance) {
      add('duration', 0.15, `Durations agree within ${Math.round(diff / 60)} min.`);
    }
  }

  const siteScore = compareSites(observation.site, candidate.site);
  if (siteScore) add('site', 0.15, siteScore);

  const o2 = observation.gases?.[0]?.o2Fraction;
  const candidateO2 = candidate.gases?.[0]?.o2Fraction;
  if (
    o2 !== undefined &&
    candidateO2 !== undefined &&
    Math.abs(o2 - candidateO2) <= GAS_TOLERANCE
  ) {
    add(
      'gas',
      0.05,
      `Oxygen fractions agree within ${Math.abs(o2 - candidateO2) * 100 < 0.05 ? 'rounding' : '1%'} ` +
        `(${(o2 * 100).toFixed(0)}% and ${(candidateO2 * 100).toFixed(0)}%).`,
    );
  }

  const score = Math.min(
    1,
    reasons.reduce((total, r) => total + r.weight, 0),
  );
  return { candidateId: candidate.id, score, reasons };
}

function compareSites(
  a: { name?: string; lat?: number; lon?: number } | undefined,
  b: { name?: string; lat?: number; lon?: number } | undefined,
): string | undefined {
  if (!a || !b) return undefined;

  const coordsA =
    a.lat !== undefined && a.lon !== undefined ? { lat: a.lat, lon: a.lon } : undefined;
  const coordsB =
    b.lat !== undefined && b.lon !== undefined ? { lat: b.lat, lon: b.lon } : undefined;
  if (isValidCoordinate(coordsA) && isValidCoordinate(coordsB)) {
    const metres = distanceM(coordsA, coordsB);
    if (metres <= 500) return `Sites are ${Math.round(metres)} m apart.`;
    return undefined;
  }

  if (a.name !== undefined && b.name !== undefined) {
    const similarity = nameSimilarity(a.name, b.name);
    if (similarity > 0.8) return `Site names match (${a.name} / ${b.name}).`;
  }
  return undefined;
}

// --- deciding ---------------------------------------------------------------

export type MatchOptions = {
  /** Raised for a row whose offset failed its semantic check. */
  autoMergeThreshold?: number;
};

/** Narrows an existing logbook to the dives worth scoring against. */
export function selectCandidates(
  observation: DiveObservation,
  dives: readonly MatchCandidate[],
): MatchCandidate[] {
  return dives.filter((dive) => {
    const time = compareTimes(observation.startTime, dive);
    if (time.deltaMs === undefined) return false;
    return time.deltaMs <= CANDIDATE_WINDOW_MS;
  });
}

export function matchObservation(
  observation: DiveObservation,
  dives: readonly MatchCandidate[],
  options: MatchOptions = {},
): MatchOutcome {
  const considered = selectCandidates(observation, dives)
    .map((candidate) => scoreMatch(observation, candidate))
    .filter((m) => m.score >= AMBIGUOUS_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const best = considered[0];
  if (!best) return { decision: 'create', considered: [] };

  if (best.score === 1 && best.reasons[0]?.signal === 'sourceRef') {
    return { decision: 'merge', best, considered };
  }

  // Never on date alone. A diver doing five dives in one day in Bonaire has
  // five records with the same date, similar depths and similar durations;
  // time of day is what separates them, and a broken offset destroys exactly
  // that.
  const onlyWeakTime = best.reasons.every((r) => r.signal === 'sameDate');
  if (onlyWeakTime) {
    return {
      decision: 'ambiguous',
      best,
      considered,
      note: 'Only the date matches. Several dives in one day look alike; time of day is what tells them apart.',
    };
  }

  // Checked before the score, not against it — see the constant above.
  if (observation.startTime.offsetSuspect === true) {
    return {
      decision: 'ambiguous',
      best,
      considered,
      note:
        'This record’s timezone offset could not be verified, so its time of day is unreliable — ' +
        'and time of day is what tells same-day dives apart.',
    };
  }

  const threshold = options.autoMergeThreshold ?? AUTO_MERGE_THRESHOLD;

  if (best.score >= threshold) {
    // Two candidates scoring alike is itself a signal: the source has
    // duplicates, or the times are wrong. Either way a human should look.
    const runnerUp = considered[1];
    if (runnerUp && best.score - runnerUp.score < 0.1) {
      return {
        decision: 'ambiguous',
        best,
        considered,
        note: 'Two existing dives match this record about equally well.',
      };
    }
    return { decision: 'merge', best, considered };
  }

  return { decision: 'ambiguous', best, considered };
}

// --- batch assignment -------------------------------------------------------

export type Assignment = {
  observationIndex: number;
  outcome: MatchOutcome;
};

/**
 * Resolves a whole batch, enforcing one-to-one.
 *
 * An existing dive can receive at most one observation from a batch. Two
 * observations both claiming one dive means the incoming file has duplicates
 * or its times are wrong, so the loser is demoted to review rather than
 * silently creating a duplicate or overwriting the winner.
 *
 * Highest-scoring claims are settled first, so the strongest evidence wins the
 * dive rather than whichever row happened to be read first.
 */
export function assignBatch(
  observations: readonly DiveObservation[],
  dives: readonly MatchCandidate[],
  options: MatchOptions = {},
): Assignment[] {
  const outcomes = observations.map((observation, observationIndex) => ({
    observationIndex,
    outcome: matchObservation(observation, dives, options),
  }));

  const claimed = new Map<string, number>();
  const order = [...outcomes].sort(
    (a, b) => (b.outcome.best?.score ?? 0) - (a.outcome.best?.score ?? 0),
  );

  for (const entry of order) {
    if (entry.outcome.decision !== 'merge') continue;
    const id = entry.outcome.best?.candidateId;
    if (id === undefined) continue;

    const holder = claimed.get(id);
    if (holder === undefined) {
      claimed.set(id, entry.observationIndex);
      continue;
    }
    entry.outcome = {
      ...entry.outcome,
      decision: 'ambiguous',
      note:
        `Row ${holder + 1} of this file matches the same existing dive more strongly. ` +
        'Two rows matching one dive usually means the file has duplicates, or its times are wrong.',
    };
  }

  return outcomes.sort((a, b) => a.observationIndex - b.observationIndex);
}

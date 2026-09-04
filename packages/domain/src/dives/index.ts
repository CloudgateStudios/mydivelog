/**
 * Dive numbering and derived statistics. Pure functions over plain data — the
 * caller loads rows and passes them in.
 */

export type NumberableDive = {
  id: string;
  startTimeUtc: Date;
  diveNumber: number;
};

export type Renumbering = {
  id: string;
  from: number;
  to: number;
};

/**
 * Assigns sequential numbers in chronological order.
 *
 * Dive number is a display ordinal, not an identifier (docs/04-data-model.md).
 * It is required and unique per diver among live dives, so sources that carry
 * no number — the sample UDDF has none across 96 dives — get one assigned here.
 *
 * Returns only the dives whose number actually changes, so a caller writes the
 * minimum number of rows. Apply the result with `renumberPlan`, not directly:
 * the uniqueness index is partial and therefore cannot be deferred, so a naive
 * shift collides with itself mid-statement.
 */
export function renumberDives(dives: readonly NumberableDive[], startAt = 1): Renumbering[] {
  if (!Number.isInteger(startAt) || startAt < 0) {
    throw new RangeError(`startAt must be a non-negative integer, received ${startAt}`);
  }

  const ordered = [...dives].sort((a, b) => {
    const d = a.startTimeUtc.getTime() - b.startTimeUtc.getTime();
    // Ties are broken by id so the result is deterministic. Repetitive dives
    // logged with only a date and no time genuinely collide.
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  const changes: Renumbering[] = [];
  ordered.forEach((dive, index) => {
    const next = startAt + index;
    if (dive.diveNumber !== next) {
      changes.push({ id: dive.id, from: dive.diveNumber, to: next });
    }
  });
  return changes;
}

/**
 * Turns a set of renumberings into the two passes needed to apply them safely.
 *
 * The unique index on (userId, diveNumber) is partial — `WHERE deletedAt IS
 * NULL`, so a soft-deleted dive does not squat its number — and Postgres cannot
 * defer a partial index. A single `SET diveNumber = diveNumber + 1` therefore
 * fails partway through, because uniqueness is checked row by row.
 *
 * Parking every affected row in the negatives first sidesteps that: live
 * numbers are positive, so no negative can collide with anything, and the
 * second pass lands them all on their final values.
 */
export function renumberPlan(changes: readonly Renumbering[]): {
  park: { id: string; diveNumber: number }[];
  land: { id: string; diveNumber: number }[];
} {
  return {
    park: changes.map((c) => ({ id: c.id, diveNumber: -c.to })),
    land: changes.map((c) => ({ id: c.id, diveNumber: c.to })),
  };
}

/** Numbers that appear more than once. Import surfaces these for review. */
export function findDuplicateDiveNumbers(dives: readonly NumberableDive[]): number[] {
  const seen = new Map<number, number>();
  for (const d of dives) {
    seen.set(d.diveNumber, (seen.get(d.diveNumber) ?? 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([number]) => number)
    .sort((a, b) => a - b);
}

export type IntervalDive = {
  id: string;
  startTimeUtc: Date;
  durationS: number | null;
};

export type DiveInterval = {
  id: string;
  surfaceIntervalS: number | null;
  repetitionIndex: number;
};

/**
 * Surface interval and repetition index, in chronological order.
 *
 * Repetition index counts dives within the same *local* day. The caller passes
 * an offset per dive because a trip can cross zones, and because a source's
 * recorded offset may itself be wrong.
 */
export function computeIntervals(
  dives: readonly (IntervalDive & { tzOffsetMinutes: number })[],
): DiveInterval[] {
  const ordered = [...dives].sort(
    (a, b) => a.startTimeUtc.getTime() - b.startTimeUtc.getTime() || a.id.localeCompare(b.id),
  );

  const out: DiveInterval[] = [];
  let previousEnd: number | null = null;
  let currentDay: string | null = null;
  let repetition = 0;

  for (const dive of ordered) {
    const localMs = dive.startTimeUtc.getTime() + dive.tzOffsetMinutes * 60_000;
    const day = new Date(localMs).toISOString().slice(0, 10);
    repetition = day === currentDay ? repetition + 1 : 1;
    currentDay = day;

    let surfaceIntervalS: number | null = null;
    if (previousEnd !== null) {
      const gap = Math.round((dive.startTimeUtc.getTime() - previousEnd) / 1000);
      // A negative gap means overlapping dives, which is bad data rather than a
      // negative surface interval. Report nothing instead of nonsense.
      surfaceIntervalS = gap >= 0 ? gap : null;
    }

    out.push({ id: dive.id, surfaceIntervalS, repetitionIndex: repetition });

    previousEnd =
      dive.durationS !== null ? dive.startTimeUtc.getTime() + dive.durationS * 1000 : null;
  }

  return out;
}

/**
 * Surface Air Consumption, normalized to the surface, in litres per minute.
 *
 * A historical observation about a dive that happened, never a prediction or a
 * planning input — see docs/10-security-privacy.md § Liability.
 */
export function surfaceAirConsumption(input: {
  startPressureBar: number;
  endPressureBar: number;
  tankVolumeL: number;
  durationS: number;
  avgDepthM: number;
}): number {
  const { startPressureBar, endPressureBar, tankVolumeL, durationS, avgDepthM } = input;
  if (durationS <= 0) throw new RangeError('durationS must be positive');
  if (tankVolumeL <= 0) throw new RangeError('tankVolumeL must be positive');
  if (endPressureBar > startPressureBar) {
    throw new RangeError('endPressureBar cannot exceed startPressureBar');
  }
  if (avgDepthM < 0) throw new RangeError('avgDepthM cannot be negative');

  const usedLitres = (startPressureBar - endPressureBar) * tankVolumeL;
  const minutes = durationS / 60;
  // Every 10 m of sea water adds one atmosphere.
  const ata = 1 + avgDepthM / 10;
  return usedLitres / minutes / ata;
}

export type LogTotals = {
  diveCount: number;
  totalBottomTimeS: number;
  maxDepthM: number | null;
  longestDiveS: number | null;
  averageDepthM: number | null;
};

/** The "Overview & Summary" numbers a diver actually wants on a dashboard. */
export function summarizeLog(
  dives: readonly { durationS: number | null; maxDepthM: number | null }[],
): LogTotals {
  const durations = dives.map((d) => d.durationS).filter((n): n is number => n !== null);
  const depths = dives.map((d) => d.maxDepthM).filter((n): n is number => n !== null);

  return {
    diveCount: dives.length,
    totalBottomTimeS: durations.reduce((a, b) => a + b, 0),
    maxDepthM: depths.length ? Math.max(...depths) : null,
    longestDiveS: durations.length ? Math.max(...durations) : null,
    averageDepthM: depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : null,
  };
}

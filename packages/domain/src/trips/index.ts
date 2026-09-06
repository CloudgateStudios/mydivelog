/**
 * Grouping dives into trips.
 *
 * The user creates trips; this only proposes them, because a diver should not
 * have to retype what their logbook already knows. Seventeen dives across one
 * week in Bonaire is obviously a trip, and asking someone to select them by
 * hand after importing them is asking them to do the computer's job.
 *
 * A proposal is never applied on its own. What it saves is the typing, not the
 * decision — "Bonaire, March 2026" is a guess about intent, and two liveaboard
 * weeks a fortnight apart may be one trip to the diver and two to this code.
 */

export type TripCandidateDive = {
  id: string;
  startTimeLocal: Date;
  siteName?: string;
  regionName?: string;
};

export type TripSuggestion = {
  /** Stable for the same input, so a page can key on it without storing it. */
  key: string;
  name: string;
  from: Date;
  to: Date;
  diveIds: string[];
};

/**
 * How many days without a dive ends a trip.
 *
 * Three, not one: a week's diving with a day off in the middle for a flight,
 * a hangover or a surface interval before altitude is one trip. Two separate
 * long weekends a month apart are not.
 */
export const TRIP_GAP_DAYS = 3;

/** Below this it is a weekend at the local quarry, not a trip worth naming. */
export const MIN_TRIP_DIVES = 3;

const DAY_MS = 86_400_000;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function suggestTrips(dives: readonly TripCandidateDive[]): TripSuggestion[] {
  if (dives.length === 0) return [];

  const ordered = [...dives].sort(
    (a, b) => a.startTimeLocal.getTime() - b.startTimeLocal.getTime(),
  );

  const clusters: TripCandidateDive[][] = [];
  let current: TripCandidateDive[] = [ordered[0] as TripCandidateDive];

  for (let i = 1; i < ordered.length; i += 1) {
    const dive = ordered[i] as TripCandidateDive;
    const previous = ordered[i - 1] as TripCandidateDive;
    const gapDays = (dayOf(dive.startTimeLocal) - dayOf(previous.startTimeLocal)) / DAY_MS;

    if (gapDays > TRIP_GAP_DAYS) {
      clusters.push(current);
      current = [];
    }
    current.push(dive);
  }
  clusters.push(current);

  return clusters
    .filter((cluster) => cluster.length >= MIN_TRIP_DIVES)
    .map((cluster) => {
      // Normalised to the day, because a Trip stores dates and not times: a
      // trip that ran "07:00 to 15:00" is a trip that ran for one day.
      const from = new Date(dayOf((cluster[0] as TripCandidateDive).startTimeLocal));
      const to = new Date(dayOf((cluster.at(-1) as TripCandidateDive).startTimeLocal));
      return {
        key: `${from.toISOString().slice(0, 10)}_${cluster.length}`,
        name: nameFor(cluster, from),
        from,
        to,
        diveIds: cluster.map((d) => d.id),
      };
    });
}

/** Midnight of the dive's own day, so "two days apart" ignores the clock. */
const dayOf = (date: Date): number => Date.parse(`${date.toISOString().slice(0, 10)}T00:00:00Z`);

/**
 * "Bonaire, March 2026" — the way a diver would label a page in a paper log.
 *
 * Prefers the region, because a trip is a place rather than a dive site, and
 * falls back to the most-dived site when no source recorded a region. With
 * neither it names the month, which is at least true.
 */
function nameFor(cluster: readonly TripCandidateDive[], from: Date): string {
  const when = `${MONTHS[from.getUTCMonth()] as string} ${from.getUTCFullYear()}`;
  const where =
    commonest(cluster.map((d) => d.regionName)) ?? commonest(cluster.map((d) => d.siteName));
  return where ? `${where}, ${when}` : when;
}

function commonest(values: readonly (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === undefined || value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  // Ties broken alphabetically so the same logbook always names a trip the
  // same way; a suggestion that changes between page loads reads as a bug.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

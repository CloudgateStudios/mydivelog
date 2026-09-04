import { normalization, type Normalization, type ObservedTime } from './observation.ts';

/**
 * Timezone repair.
 *
 * The seed UDDF writes every timestamp as `2026-03-06T19:07:42.000-00:04`. That
 * is not a four-minute offset: the exporter put the offset's *hours* into the
 * minutes field, and the true value is −04:00. Offsets seen across the file are
 * `-00:04` (70 dives), `-00:06` (23) and `-00:05` (3) — Atlantic, Central and
 * Eastern.
 *
 * A conforming XML parser accepts all of this without complaint, which is the
 * whole problem: the file is syntactically valid and semantically wrong. Every
 * dive lands 4–6 hours off, dives cross midnight into the wrong day, and
 * surface intervals between repetitive dives become nonsense.
 *
 * So parsers here validate semantics, not just syntax.
 */

/** Real-world zones are whole minutes but never a sub-hour offset this small. */
const SUSPECT_MAGNITUDE_MINUTES = 60;

/**
 * Does this offset look like the hours-in-the-minutes-field bug?
 *
 * Legitimate sub-hour offsets exist — India is +05:30, Nepal +05:45, Chatham
 * Islands +12:45 — but all of them exceed an hour in magnitude. An offset under
 * an hour that is not a whole number of hours has no counterpart on earth.
 * Notably +00:00 and -00:00 are *not* suspect: UTC is real.
 */
export function isSuspectOffset(offsetMinutes: number): boolean {
  return Math.abs(offsetMinutes) < SUSPECT_MAGNITUDE_MINUTES && offsetMinutes % 60 !== 0;
}

/**
 * What the buggy writer meant. `-00:04` was `-04:00`, so the minutes are really
 * hours: multiply by 60.
 */
export function interpretAsHours(offsetMinutes: number): number {
  return offsetMinutes * 60;
}

/**
 * Resolves a zone offset from coordinates and a local date, in minutes east of
 * UTC. Injected rather than imported: a coordinates-to-timezone lookup carries
 * a geographic database, and this package stays pure so it tests in
 * milliseconds. The API wires in a real implementation.
 */
export type TzResolver = (lat: number, lon: number, localDate: Date) => number | undefined;

export type OffsetRepair = {
  offsetMinutes?: number;
  suspect: boolean;
  normalizations: Normalization[];
};

/**
 * Corroborates or corrects a suspect offset against the dive site's geography.
 *
 * Bonaire at 12.10°N 68.29°W is −04:00, which confirms that `-00:04` meant
 * −04:00. When geography agrees, the correction is applied with high
 * confidence. When it disagrees — or when there are no coordinates to check
 * against — the offset is left exactly as the file wrote it and flagged, so a
 * human decides. Guessing at someone's dive times is worse than admitting we
 * cannot tell.
 */
export function repairOffset(
  offsetMinutes: number | undefined,
  site: { lat?: number; lon?: number } | undefined,
  localDate: Date | undefined,
  resolveTz?: TzResolver,
): OffsetRepair {
  if (offsetMinutes === undefined) return { suspect: false, normalizations: [] };
  if (!isSuspectOffset(offsetMinutes)) {
    return { offsetMinutes, suspect: false, normalizations: [] };
  }

  const intended = interpretAsHours(offsetMinutes);
  const derived =
    site?.lat !== undefined && site.lon !== undefined && localDate !== undefined && resolveTz
      ? resolveTz(site.lat, site.lon, localDate)
      : undefined;

  if (derived !== undefined && derived === intended) {
    return {
      offsetMinutes: intended,
      suspect: false,
      normalizations: [
        normalization(
          'startTime.offsetMinutes',
          offsetMinutes,
          intended,
          `Offset ${formatOffset(offsetMinutes)} is not a real zone; the site's coordinates ` +
            `resolve to ${formatOffset(intended)}, so the exporter wrote hours into the minutes field.`,
          'high',
        ),
      ],
    };
  }

  // Either geography contradicts the reading, or there is nothing to check it
  // against. Keep what the file said and let a human look.
  const because =
    derived === undefined
      ? 'no site coordinates to corroborate it'
      : `the site's coordinates resolve to ${formatOffset(derived)}, not ${formatOffset(intended)}`;

  return {
    offsetMinutes,
    suspect: true,
    normalizations: [
      normalization(
        'startTime.offsetMinutes',
        offsetMinutes,
        offsetMinutes,
        `Offset ${formatOffset(offsetMinutes)} is not a real zone and probably means ` +
          `${formatOffset(intended)}, but ${because}. Left unchanged for review.`,
        'low',
      ),
    ],
  };
}

/** `-240` → `-04:00`. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Fills in whichever of UTC/local/offset can be derived from the other two.
 *
 * A dive needs all three independently: the local time is the one the diver
 * remembers, and it has to survive regardless of what any zone logic later
 * concludes.
 */
export function completeTime(time: ObservedTime): ObservedTime {
  const { utc, local, offsetMinutes } = time;
  const msPerMinute = 60_000;

  if (utc && offsetMinutes !== undefined && !local) {
    return { ...time, local: new Date(utc.getTime() + offsetMinutes * msPerMinute) };
  }
  if (local && offsetMinutes !== undefined && !utc) {
    return { ...time, utc: new Date(local.getTime() - offsetMinutes * msPerMinute) };
  }
  if (utc && local && offsetMinutes === undefined) {
    return { ...time, offsetMinutes: Math.round((local.getTime() - utc.getTime()) / msPerMinute) };
  }
  return time;
}

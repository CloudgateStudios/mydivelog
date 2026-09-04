import tzLookup from 'tz-lookup';
import type { TzResolver } from '@mydivelog/domain';

/**
 * Coordinates and a date to a UTC offset in minutes.
 *
 * This is what lets the engine correct the seed UDDF's `-00:04` to `-04:00`
 * instead of sending all 96 dives to review. The rule refuses to guess without
 * independent corroboration, and geography is that corroboration.
 *
 * It lives in the API rather than in `packages/domain` because it carries a
 * geographic database, and domain stays dependency-free so it tests in
 * milliseconds. The engine takes this as an injected function for exactly that
 * reason.
 */

/**
 * `Intl` gives the offset at a specific instant, which matters: the same site
 * is -04:00 or -05:00 depending on the date wherever daylight saving applies.
 * Bonaire does not observe it, but Michigan does, and the seed file has both.
 */
function offsetMinutesAt(zone: string, at: Date): number | undefined {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).format(at);

    // "3/6/2026, GMT-04:00" — and plain "GMT" for UTC itself.
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(formatted);
    if (!match) return /GMT/.test(formatted) ? 0 : undefined;

    const [, sign, hours, minutes] = match;
    const magnitude = Number(hours) * 60 + Number(minutes);
    return sign === '-' ? -magnitude : magnitude;
  } catch {
    // An unknown zone name, or a Node build without full ICU. Returning
    // undefined leaves the offset flagged for review, which is the safe answer.
    return undefined;
  }
}

export const resolveTimezone: TzResolver = (lat, lon, localDate) => {
  try {
    const zone = tzLookup(lat, lon);
    return zone === undefined ? undefined : offsetMinutesAt(zone, localDate);
  } catch {
    // tz-lookup throws on coordinates it cannot place — mid-ocean, or the
    // poles. A dive there is possible; guessing its timezone is not.
    return undefined;
  }
};

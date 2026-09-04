/**
 * UDDF timestamp parsing.
 *
 * This is deliberately hand-rolled rather than `new Date(text)`, and that is
 * the entire point of the module.
 *
 * `new Date('2026-03-06T19:07:42.000-00:04')` returns a perfectly valid
 * instant — with the four-minute offset applied. The seed file's offsets are
 * hours written into the minutes field, so every dive in it would land four to
 * six hours from where it belongs, and nothing downstream would know. Dives
 * cross midnight into the wrong day and surface intervals between repetitive
 * dives become nonsense.
 *
 * So the wall clock and the offset are extracted separately, and neither is
 * applied to the other until the offset has been checked.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(.*)$/;
const OFFSET = /^(?:([+-])(\d{2}):?(\d{2})|(Z))$/;

export type ParsedTimestamp = {
  /** The clock face at the dive site. No zone applied, ever. */
  local: Date;
  /** Minutes east of UTC, exactly as the file wrote it. Not repaired here. */
  offsetMinutes?: number;
  raw: string;
};

export function parseUddfDateTime(text: string): ParsedTimestamp | undefined {
  const trimmed = text.trim();
  const m = ISO.exec(trimmed);
  if (!m) return undefined;

  const [, year, month, day, hour, minute, second, fraction, rest] = m;
  const ms = fraction ? Number(`0.${fraction}`) * 1000 : 0;

  // Built as UTC so the value is a pure wall clock: constructing it in local
  // time would make the result depend on the server's timezone, which is a bug
  // this codebase has already shipped once.
  const local = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      second ? Number(second) : 0,
      Math.round(ms),
    ),
  );
  if (Number.isNaN(local.getTime())) return undefined;

  // Date.UTC rolls impossible components over rather than rejecting them:
  // month 13 becomes January of the next year. A dive log is not the place to
  // silently invent a date.
  if (local.getUTCFullYear() !== Number(year) || local.getUTCMonth() !== Number(month) - 1) {
    return undefined;
  }

  const offsetMinutes = parseOffset(rest ?? '');
  return offsetMinutes === undefined
    ? { local, raw: trimmed }
    : { local, offsetMinutes, raw: trimmed };
}

function parseOffset(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const m = OFFSET.exec(trimmed);
  if (!m) return undefined;
  const [, sign, hours, minutes, zulu] = m;
  if (zulu) return 0;
  const magnitude = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -magnitude : magnitude;
}

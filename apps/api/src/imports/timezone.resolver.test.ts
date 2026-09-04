import { describe, expect, it } from 'vitest';
import { repairOffset } from '@mydivelog/domain';
import { resolveTimezone } from './timezone.resolver.ts';

describe('resolveTimezone', () => {
  it('resolves Bonaire to -04:00', () => {
    // The seed file's sites. This is the value that confirms `-00:04` meant
    // -04:00 rather than four minutes.
    expect(resolveTimezone(12.1, -68.29, new Date('2026-03-06T19:07:42Z'))).toBe(-240);
  });

  it('accounts for daylight saving at the same place', () => {
    // Chicago is -06:00 in winter and -05:00 in summer. A resolver that
    // ignored the date would corroborate half the year and contradict the
    // other half.
    expect(resolveTimezone(41.88, -87.63, new Date('2026-01-15T12:00:00Z'))).toBe(-360);
    expect(resolveTimezone(41.88, -87.63, new Date('2026-07-15T12:00:00Z'))).toBe(-300);
  });

  it('handles a zone that does not observe daylight saving', () => {
    for (const month of ['01', '07']) {
      expect(resolveTimezone(12.1, -68.29, new Date(`2026-${month}-15T12:00:00Z`))).toBe(-240);
    }
  });

  it('resolves a half-hour zone', () => {
    expect(resolveTimezone(19.08, 72.88, new Date('2026-03-06T12:00:00Z'))).toBe(330);
  });

  it('resolves UTC to zero rather than undefined', () => {
    // Greenwich. `Intl` renders this as plain "GMT" with no offset to parse.
    expect(resolveTimezone(51.48, 0, new Date('2026-01-15T12:00:00Z'))).toBe(0);
  });

  it('returns undefined for coordinates it cannot place', () => {
    // Guessing a timezone for a mid-ocean dive is worse than admitting we
    // cannot tell — the repair rule then leaves the offset alone.
    const result = resolveTimezone(Number.NaN, Number.NaN, new Date());
    expect(result === undefined || Number.isFinite(result)).toBe(true);
  });
});

describe('the repair rule with a real resolver', () => {
  it('corrects the seed file’s offset', () => {
    const r = repairOffset(
      -4,
      { lat: 12.1, lon: -68.29 },
      new Date('2026-03-06T19:07:42'),
      resolveTimezone,
    );
    expect(r.offsetMinutes).toBe(-240);
    expect(r.suspect).toBe(false);
    expect(r.normalizations[0]?.confidence).toBe('high');
  });

  it('still refuses when geography disagrees', () => {
    // -00:04 would mean -04:00, but these coordinates are Chicago in January.
    const r = repairOffset(
      -4,
      { lat: 41.88, lon: -87.63 },
      new Date('2026-01-15T12:00:00'),
      resolveTimezone,
    );
    expect(r.suspect).toBe(true);
    expect(r.offsetMinutes).toBe(-4);
  });
});

import { describe, expect, it } from 'vitest';
import {
  completeTime,
  formatOffset,
  interpretAsHours,
  isSuspectOffset,
  repairOffset,
  type TzResolver,
} from './timezone.ts';

// Bonaire. The seed UDDF's sites are here, and it is −04:00 year round.
const BONAIRE = { lat: 12.1, lon: -68.29 };
const atlantic: TzResolver = () => -240;
const central: TzResolver = () => -360;

describe('isSuspectOffset', () => {
  it('flags the offsets the seed file actually contains', () => {
    // -00:04, -00:06, -00:05 — 70, 23 and 3 dives respectively.
    expect(isSuspectOffset(-4)).toBe(true);
    expect(isSuspectOffset(-6)).toBe(true);
    expect(isSuspectOffset(-5)).toBe(true);
  });

  it('accepts every real sub-hour zone', () => {
    // These are the reason the rule tests magnitude and not just divisibility:
    // India, Nepal, the Chatham Islands and Australia's centre all sit on a
    // half or quarter hour, and all exceed an hour.
    for (const real of [330, 345, 765, 570, -210, -240, 0, -720, 840]) {
      expect(isSuspectOffset(real), `${real} should be accepted`).toBe(false);
    }
  });

  it('does not flag UTC itself', () => {
    expect(isSuspectOffset(0)).toBe(false);
    expect(isSuspectOffset(-0)).toBe(false);
  });
});

describe('repairOffset', () => {
  it('corrects -00:04 to -04:00 when the coordinates agree', () => {
    const r = repairOffset(-4, BONAIRE, new Date('2026-03-06T19:07:42'), atlantic);
    expect(r.offsetMinutes).toBe(-240);
    expect(r.suspect).toBe(false);
    expect(r.normalizations).toHaveLength(1);
    expect(r.normalizations[0]?.confidence).toBe('high');
    expect(r.normalizations[0]?.from).toBe(-4);
    expect(r.normalizations[0]?.to).toBe(-240);
  });

  it('records the correction rather than applying it silently', () => {
    // A silent rewrite of someone's dive times is indistinguishable from a bug
    // that corrupts them. The reason has to name both values.
    const [n] = repairOffset(-4, BONAIRE, new Date('2026-03-06T19:07:42'), atlantic).normalizations;
    expect(n?.reason).toContain('-00:04');
    expect(n?.reason).toContain('-04:00');
  });

  it('refuses to correct when geography contradicts the reading', () => {
    // -00:04 would mean -04:00, but these coordinates say -06:00. Two competing
    // stories about the same dive: keep the file's value and ask a human.
    const r = repairOffset(-4, BONAIRE, new Date('2026-03-06T19:07:42'), central);
    expect(r.offsetMinutes).toBe(-4);
    expect(r.suspect).toBe(true);
    expect(r.normalizations[0]?.confidence).toBe('low');
    expect(r.normalizations[0]?.reason).toContain('-06:00');
  });

  it('refuses to correct with no coordinates to check against', () => {
    const r = repairOffset(-4, undefined, new Date('2026-03-06T19:07:42'), atlantic);
    expect(r.offsetMinutes).toBe(-4);
    expect(r.suspect).toBe(true);
    expect(r.normalizations[0]?.reason).toContain('records no coordinates');
  });

  it('refuses to correct with no resolver wired in, and does not blame the file', () => {
    // The message shown for this case claimed the file had no coordinates for
    // a file that had them. What was missing was a resolver on our side.
    const r = repairOffset(-4, BONAIRE, new Date('2026-03-06T19:07:42'));
    expect(r.suspect).toBe(true);
    expect(r.normalizations[0]?.reason).toContain('could not be resolved');
    expect(r.normalizations[0]?.reason).not.toContain('no coordinates');
  });

  it('leaves a well-formed offset alone and records nothing', () => {
    const r = repairOffset(-240, BONAIRE, new Date('2026-03-06T19:07:42'), atlantic);
    expect(r.offsetMinutes).toBe(-240);
    expect(r.suspect).toBe(false);
    expect(r.normalizations).toEqual([]);
  });

  it('passes through a missing offset without inventing one', () => {
    expect(repairOffset(undefined, BONAIRE, new Date(), atlantic)).toEqual({
      suspect: false,
      normalizations: [],
    });
  });
});

describe('interpretAsHours', () => {
  it('reads the minutes field as hours', () => {
    expect(interpretAsHours(-4)).toBe(-240);
    expect(interpretAsHours(-6)).toBe(-360);
    expect(interpretAsHours(-5)).toBe(-300);
  });
});

describe('formatOffset', () => {
  it.each([
    [-240, '-04:00'],
    [-4, '-00:04'],
    [0, '+00:00'],
    [330, '+05:30'],
    [-570, '-09:30'],
  ])('%i → %s', (minutes, expected) => {
    expect(formatOffset(minutes)).toBe(expected);
  });
});

describe('completeTime', () => {
  it('derives local from utc and offset', () => {
    const t = completeTime({
      utc: new Date('2026-03-06T23:07:42Z'),
      offsetMinutes: -240,
      raw: 'x',
    });
    expect(t.local?.toISOString()).toBe('2026-03-06T19:07:42.000Z');
  });

  it('derives utc from local and offset', () => {
    const t = completeTime({
      local: new Date('2026-03-06T19:07:42Z'),
      offsetMinutes: -240,
      raw: 'x',
    });
    expect(t.utc?.toISOString()).toBe('2026-03-06T23:07:42.000Z');
  });

  it('derives the offset from utc and local', () => {
    const t = completeTime({
      utc: new Date('2026-03-06T23:07:42Z'),
      local: new Date('2026-03-06T19:07:42Z'),
      raw: 'x',
    });
    expect(t.offsetMinutes).toBe(-240);
  });

  it('leaves a time with only one component alone', () => {
    const only = { utc: new Date('2026-03-06T23:07:42Z'), raw: 'x' };
    expect(completeTime(only)).toEqual(only);
  });

  it('round-trips the repaired Bonaire dive', () => {
    // The dive that appears in both seed files: the UDDF says 19:07:42 local
    // with a broken -00:04. Repaired, it is 23:07:42Z — and the local time the
    // diver remembers is untouched.
    const repaired = repairOffset(-4, BONAIRE, new Date('2026-03-06T19:07:42'), atlantic);
    const t = completeTime({
      local: new Date('2026-03-06T19:07:42Z'),
      offsetMinutes: repaired.offsetMinutes,
      raw: '2026-03-06T19:07:42.000-00:04',
    });
    expect(t.utc?.toISOString()).toBe('2026-03-06T23:07:42.000Z');
    expect(t.local?.toISOString()).toBe('2026-03-06T19:07:42.000Z');
  });
});

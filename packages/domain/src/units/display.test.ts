import { describe, expect, it } from 'vitest';
import { depth, duration, optional, pressure, temperature, weight } from './display.ts';

/**
 * The seed data is imperial throughout — 46 ft, 75 °F, 24 lbs — and the
 * database is SI. A diver who logs in feet and is shown 14.1 m everywhere is
 * reading someone else's logbook.
 */

describe('metric, the default', () => {
  it('shows what is stored', () => {
    expect(depth(14.099).text).toBe('14.1 m');
    expect(temperature(26.5).text).toBe('26.5 °C');
    expect(weight(10.886).text).toBe('10.9 kg');
    expect(pressure(200).text).toBe('200 bar');
  });
});

describe('imperial', () => {
  const prefs = { unitSystem: 'imperial' as const };

  it('converts back to what the diver wrote down', () => {
    // 14.099 m is the computer's reading of a dive the diver logged as 46 ft.
    expect(depth(14.099, prefs).text).toBe('46 ft');
    expect(temperature(26.5, prefs).text).toBe('80 °F');
    expect(weight(10.886, prefs).text).toBe('24 lb');
  });

  it('rounds to a precision that means the same thing in both systems', () => {
    // A foot is a finer division than a metre, so feet get no decimal and
    // metres get one. `46.3 ft` implies a precision no dive computer has.
    expect(depth(14.099, prefs).text).not.toContain('.');
    expect(depth(14.099).text).toContain('.');
  });
});

describe('per-quantity overrides', () => {
  it('lets a diver use feet and Celsius together', () => {
    // Not a hypothetical: the schema comment names it, and it is common among
    // divers trained in one system who dive in another.
    const mixed = { unitSystem: 'metric' as const, depthUnit: 'ft' as const };
    expect(depth(14.099, mixed).text).toBe('46 ft');
    expect(temperature(26.5, mixed).text).toBe('26.5 °C');
  });

  it('lets an override go the other way too', () => {
    const mixed = { unitSystem: 'imperial' as const, temperatureUnit: 'C' as const };
    expect(depth(14.099, mixed).text).toBe('46 ft');
    expect(temperature(26.5, mixed).text).toBe('26.5 °C');
  });

  it('follows the system when no override is set', () => {
    expect(weight(10.886, { unitSystem: 'imperial' }).text).toBe('24 lb');
    expect(weight(10.886, { unitSystem: 'imperial', weightUnit: 'kg' }).text).toBe('10.9 kg');
  });
});

describe('duration', () => {
  it('is minutes everywhere', () => {
    expect(duration(2776).text).toBe('46 min');
    expect(duration(60).text).toBe('1 min');
  });
});

describe('absent values', () => {
  it('shows a dash rather than a zero', () => {
    // A dive with no recorded visibility is not a dive with zero visibility.
    // The whole product rests on not inventing what a source did not have.
    expect(optional(null, depth)).toBe('—');
    expect(optional(undefined, temperature)).toBe('—');
  });

  it('still shows a real zero', () => {
    // Zero visibility is a miserable dive, but it is a reading.
    expect(optional(0, depth)).toBe('0.0 m');
  });
});

describe('the value and the unit are separable', () => {
  it('gives both, so a caller can lay them out', () => {
    const d = depth(14.099, { unitSystem: 'imperial' });
    expect(d.unit).toBe('ft');
    expect(Math.round(d.value)).toBe(46);
  });
});

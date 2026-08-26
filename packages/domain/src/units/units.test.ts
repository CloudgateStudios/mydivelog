import { describe, expect, it } from 'vitest';
import {
  barToPsi,
  celsiusToFahrenheit,
  celsiusToKelvin,
  cubicFeetToLitres,
  dayFractionToSeconds,
  excelSerialToUtcDate,
  fahrenheitToCelsius,
  feetToMetres,
  fractionToPercent,
  kelvinToCelsius,
  kilogramsToPounds,
  litresToCubicFeet,
  metresToFeet,
  percentToFraction,
  poundsToKilograms,
  psiToBar,
  secondsToDayFraction,
} from './index.js';

/**
 * The anchor cases below are real values lifted from the two seed files
 * described in docs/02-source-data-analysis.md. Using real data rather than
 * invented numbers means these tests fail if a conversion ever stops agreeing
 * with the files the import engine has to read.
 */

describe('depth', () => {
  it('converts the sample dive depth from the spreadsheet', () => {
    // Spreadsheet dive #195 recorded 46 ft at Angel City.
    expect(feetToMetres(46)).toBeCloseTo(14.0208, 4);
  });

  it('agrees with the UDDF reading for the same dive', () => {
    // The dive computer recorded 14.099043 m for what the diver wrote as 46 ft.
    expect(metresToFeet(14.099043)).toBeCloseTo(46.2567, 4);
  });

  it('round-trips', () => {
    for (const ft of [0, 1, 33, 46, 130, 330.5]) {
      expect(metresToFeet(feetToMetres(ft))).toBeCloseTo(ft, 10);
    }
  });
});

describe('temperature', () => {
  it('converts kelvin as UDDF reports it', () => {
    // Every waypoint temperature in the Oceanic+ export is in kelvin.
    expect(kelvinToCelsius(299.74)).toBeCloseTo(26.59, 2);
  });

  it('converts fahrenheit as the spreadsheet reports it', () => {
    expect(fahrenheitToCelsius(79.2)).toBeCloseTo(26.2222, 4);
    expect(fahrenheitToCelsius(32)).toBe(0);
  });

  it('handles the scales meeting at -40', () => {
    expect(fahrenheitToCelsius(-40)).toBeCloseTo(-40, 10);
  });

  it('round-trips', () => {
    for (const c of [-40, 0, 4, 26.59, 100]) {
      expect(fahrenheitToCelsius(celsiusToFahrenheit(c))).toBeCloseTo(c, 10);
      expect(kelvinToCelsius(celsiusToKelvin(c))).toBeCloseTo(c, 10);
    }
  });
});

describe('mass', () => {
  it('converts the weight the diver actually logged', () => {
    // 24 lb appears throughout the early spreadsheet rows.
    expect(poundsToKilograms(24)).toBeCloseTo(10.8862, 4);
  });

  it('round-trips', () => {
    for (const lb of [0, 16, 18, 22, 24]) {
      expect(kilogramsToPounds(poundsToKilograms(lb))).toBeCloseTo(lb, 10);
    }
  });
});

describe('pressure and volume', () => {
  it('converts a standard aluminium 80 fill', () => {
    expect(psiToBar(3000)).toBeCloseTo(206.843, 3);
    expect(cubicFeetToLitres(80)).toBeCloseTo(2265.348, 3);
  });

  it('round-trips', () => {
    expect(barToPsi(psiToBar(3000))).toBeCloseTo(3000, 8);
    expect(litresToCubicFeet(cubicFeetToLitres(80))).toBeCloseTo(80, 8);
  });
});

describe('gas fractions', () => {
  it('converts the EAN labels used in the spreadsheet', () => {
    expect(percentToFraction(32)).toBeCloseTo(0.32, 10);
    expect(fractionToPercent(0.33)).toBeCloseTo(33, 10);
  });

  it('reconciles the two sources disagreeing about the same dive', () => {
    // Spreadsheet says EAN 32; the computer sensed o2 0.33. Both are valid
    // representations and the merge engine must be able to compare them.
    expect(fractionToPercent(0.33) - 32).toBeCloseTo(1, 10);
  });
});

describe('excel dates', () => {
  it('converts the serials in the workbook', () => {
    // Row 1 of the Dive Data sheet: serial 41062, the diver's first open water dive.
    expect(excelSerialToUtcDate(41062).toISOString()).toBe('2012-06-02T00:00:00.000Z');
    expect(excelSerialToUtcDate(41063).toISOString()).toBe('2012-06-03T00:00:00.000Z');
    // The last row, in Bonaire.
    expect(excelSerialToUtcDate(46087).toISOString()).toBe('2026-03-06T00:00:00.000Z');
  });

  it('ignores any fractional part, since time lives in its own column', () => {
    expect(excelSerialToUtcDate(41062.9999).toISOString()).toBe('2012-06-02T00:00:00.000Z');
  });
});

describe('excel day fractions', () => {
  it('converts the Time In column', () => {
    // 0.41180555… is 09:53:00, the first dive's entry time.
    expect(dayFractionToSeconds(0.41180555555555554)).toBe(35_580);
    expect(dayFractionToSeconds(0)).toBe(0);
    expect(dayFractionToSeconds(0.5)).toBe(43_200);
  });

  it('rounds float noise to whole seconds', () => {
    // These fractions are float representations of whole minutes and land
    // fractionally short; truncation would lose a second on most rows.
    expect(dayFractionToSeconds(0.021527777777777778)).toBe(1860); // 31 minutes
  });

  it('rejects values outside a single day', () => {
    expect(() => dayFractionToSeconds(1)).toThrow(RangeError);
    expect(() => dayFractionToSeconds(-0.1)).toThrow(RangeError);
  });

  it('round-trips', () => {
    for (const s of [0, 1860, 35_580, 86_399]) {
      expect(dayFractionToSeconds(secondsToDayFraction(s))).toBe(s);
    }
  });
});

describe('input guards', () => {
  it('rejects non-finite input rather than propagating NaN', () => {
    expect(() => feetToMetres(Number.NaN)).toThrow(RangeError);
    expect(() => kelvinToCelsius(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => poundsToKilograms(Number.NaN)).toThrow(RangeError);
  });
});

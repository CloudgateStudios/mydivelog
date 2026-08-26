/**
 * Unit conversion. Everything in MyDiveLog is stored in SI; these are the
 * functions that get data in and out of that form.
 *
 * The constants below are exact by definition, not approximations. A wrong
 * constant here silently corrupts an entire dive history, so they are spelled
 * out rather than derived, and every one is covered by a round-trip test.
 *
 * See docs/04-data-model.md § "Store SI. Always."
 */

/** Exact: the international foot is defined as 0.3048 m. */
const METRES_PER_FOOT = 0.3048;
/** Exact: the international avoirdupois pound. */
const KILOGRAMS_PER_POUND = 0.45359237;
/** Exact: 1 bar = 100000 Pa, 1 psi = 4.4482216152605 / 0.00064516 Pa. */
const PASCALS_PER_PSI = 6894.757293168361;
const PASCALS_PER_BAR = 100_000;
/** Exact: 1 ft³ = 0.3048³ m³ = 28.316846592 L. */
const LITRES_PER_CUBIC_FOOT = 28.316846592;
/** Exact by definition of the Celsius scale. */
const KELVIN_AT_ZERO_CELSIUS = 273.15;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${value}`);
  }
  return value;
}

// --- Depth, distance -------------------------------------------------------

export const feetToMetres = (feet: number): number => finite(feet, 'feet') * METRES_PER_FOOT;
export const metresToFeet = (metres: number): number => finite(metres, 'metres') / METRES_PER_FOOT;

// --- Temperature -----------------------------------------------------------

export const fahrenheitToCelsius = (f: number): number => (finite(f, 'fahrenheit') - 32) * (5 / 9);
export const celsiusToFahrenheit = (c: number): number => finite(c, 'celsius') * (9 / 5) + 32;

/** UDDF reports temperature in kelvin — see the Oceanic+ sample, `299.74`. */
export const kelvinToCelsius = (k: number): number => finite(k, 'kelvin') - KELVIN_AT_ZERO_CELSIUS;
export const celsiusToKelvin = (c: number): number => finite(c, 'celsius') + KELVIN_AT_ZERO_CELSIUS;

// --- Mass ------------------------------------------------------------------

export const poundsToKilograms = (lb: number): number => finite(lb, 'pounds') * KILOGRAMS_PER_POUND;
export const kilogramsToPounds = (kg: number): number =>
  finite(kg, 'kilograms') / KILOGRAMS_PER_POUND;

// --- Pressure --------------------------------------------------------------

export const psiToBar = (psi: number): number =>
  (finite(psi, 'psi') * PASCALS_PER_PSI) / PASCALS_PER_BAR;
export const barToPsi = (bar: number): number =>
  (finite(bar, 'bar') * PASCALS_PER_BAR) / PASCALS_PER_PSI;

// --- Volume ----------------------------------------------------------------

export const cubicFeetToLitres = (ft3: number): number =>
  finite(ft3, 'cubic feet') * LITRES_PER_CUBIC_FOOT;
export const litresToCubicFeet = (l: number): number => finite(l, 'litres') / LITRES_PER_CUBIC_FOOT;

// --- Gas -------------------------------------------------------------------

/**
 * "EAN 32" and similar labels give oxygen as a percentage; UDDF gives it as a
 * fraction. Storage is always the fraction.
 */
export const percentToFraction = (percent: number): number => finite(percent, 'percent') / 100;
export const fractionToPercent = (fraction: number): number => finite(fraction, 'fraction') * 100;

// --- Spreadsheet time ------------------------------------------------------

/**
 * Excel's day-zero. Serial 1 is 1900-01-01, but Excel also treats 1900 as a
 * leap year, so anchoring at 1899-12-30 makes every serial from 61 onward
 * correct. Dive logs do not contain dates from January or February 1900, so
 * the pre-61 discrepancy is not worth modelling.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/**
 * Converts an Excel date serial to a Date at UTC midnight.
 *
 * The workbook stores dates as serials (`41062` = 2012-06-02) and times as
 * day fractions in a separate column, so this deliberately ignores any
 * fractional part — combine with `dayFractionToSeconds` for a timestamp.
 */
export function excelSerialToUtcDate(serial: number): Date {
  finite(serial, 'excel serial');
  return new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY);
}

/**
 * Converts an Excel day fraction to seconds since midnight.
 * `0.41180555…` → 35580 (09:53:00). Rounded to the nearest second: the
 * fractions are float representations of whole minutes and land a few
 * microseconds off.
 */
export function dayFractionToSeconds(fraction: number): number {
  finite(fraction, 'day fraction');
  if (fraction < 0 || fraction >= 1) {
    throw new RangeError(`day fraction must be in [0, 1), received ${fraction}`);
  }
  return Math.round(fraction * 86_400);
}

/** Inverse of `dayFractionToSeconds`, for writing spreadsheet exports. */
export function secondsToDayFraction(seconds: number): number {
  finite(seconds, 'seconds');
  if (seconds < 0 || seconds >= 86_400) {
    throw new RangeError(`seconds must be in [0, 86400), received ${seconds}`);
  }
  return seconds / 86_400;
}

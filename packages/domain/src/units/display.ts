import { celsiusToFahrenheit, kilogramsToPounds, metresToFeet, barToPsi } from './index.ts';

/**
 * Formatting values for a person.
 *
 * Everything is stored in SI and converted at the edges. This is that edge.
 *
 * Per-quantity overrides exist because divers are not consistent, and being
 * right about that matters more than being tidy: plenty of people who log
 * depth in feet still think in Celsius, and forcing them to pick one system
 * makes half their logbook read wrong.
 */

export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

export type UnitPreferences = {
  unitSystem: UnitSystem;
  /** Each overrides the system for one quantity. Absent means follow it. */
  depthUnit?: 'm' | 'ft';
  temperatureUnit?: 'C' | 'F';
  weightUnit?: 'kg' | 'lb';
  pressureUnit?: 'bar' | 'psi';
};

export const DEFAULT_UNITS: UnitPreferences = { unitSystem: 'metric' };

const imperial = (prefs: UnitPreferences): boolean => prefs.unitSystem === 'imperial';

/** A value and its unit, kept apart so a caller can lay them out as it likes. */
export type Measurement = { value: number; unit: string; text: string };

const measurement = (value: number, unit: string, decimals: number): Measurement => ({
  value,
  unit,
  text: `${value.toFixed(decimals)} ${unit}`,
});

export function depth(metres: number, prefs: UnitPreferences = DEFAULT_UNITS): Measurement {
  const useFeet = prefs.depthUnit ? prefs.depthUnit === 'ft' : imperial(prefs);
  // A foot is a finer division than a metre, so feet get no decimal and
  // metres get one — the precision shown should mean roughly the same thing
  // either way rather than implying millimetre accuracy in one system.
  return useFeet ? measurement(metresToFeet(metres), 'ft', 0) : measurement(metres, 'm', 1);
}

export function temperature(celsius: number, prefs: UnitPreferences = DEFAULT_UNITS): Measurement {
  const useFahrenheit = prefs.temperatureUnit ? prefs.temperatureUnit === 'F' : imperial(prefs);
  return useFahrenheit
    ? measurement(celsiusToFahrenheit(celsius), '°F', 0)
    : measurement(celsius, '°C', 1);
}

export function weight(kilograms: number, prefs: UnitPreferences = DEFAULT_UNITS): Measurement {
  const usePounds = prefs.weightUnit ? prefs.weightUnit === 'lb' : imperial(prefs);
  return usePounds
    ? measurement(kilogramsToPounds(kilograms), 'lb', 0)
    : measurement(kilograms, 'kg', 1);
}

export function pressure(bar: number, prefs: UnitPreferences = DEFAULT_UNITS): Measurement {
  const usePsi = prefs.pressureUnit ? prefs.pressureUnit === 'psi' : imperial(prefs);
  return usePsi ? measurement(barToPsi(bar), 'psi', 0) : measurement(bar, 'bar', 0);
}

/** Duration is the same everywhere. Included so callers have one import. */
export function duration(seconds: number): Measurement {
  const minutes = Math.round(seconds / 60);
  return { value: minutes, unit: 'min', text: `${minutes} min` };
}

/**
 * Formats a value that may be absent.
 *
 * An em dash rather than a zero: a dive with no recorded visibility is not a
 * dive with zero visibility, and the whole product rests on not inventing
 * data a source did not have.
 */
export function optional(
  value: number | null | undefined,
  format: (n: number, prefs: UnitPreferences) => Measurement,
  prefs: UnitPreferences = DEFAULT_UNITS,
): string {
  return value === null || value === undefined ? '—' : format(value, prefs).text;
}

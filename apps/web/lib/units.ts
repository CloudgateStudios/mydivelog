import { units, type UnitPreferences } from '@mydivelog/domain';
import { apiJson } from './api';

/**
 * The diver's units, and helpers that already know them.
 *
 * Fetched per request rather than threaded through every component: it is one
 * small row, the page is server-rendered anyway, and a component that has to
 * be handed preferences is a component someone will forget to hand them to.
 */
export type Units = ReturnType<typeof formatters>;

export async function loadUnits(): Promise<UnitPreferences> {
  return apiJson<UnitPreferences>('/v1/preferences').catch(() => ({
    unitSystem: 'metric' as const,
  }));
}

export function formatters(prefs: UnitPreferences) {
  return {
    prefs,
    depth: (metres: number | null | undefined): string =>
      units.optional(metres, units.depth, prefs),
    temperature: (celsius: number | null | undefined): string =>
      units.optional(celsius, units.temperature, prefs),
    weight: (kilograms: number | null | undefined): string =>
      units.optional(kilograms, units.weight, prefs),
    pressure: (bar: number | null | undefined): string =>
      units.optional(bar, units.pressure, prefs),
    duration: (seconds: number | null | undefined): string =>
      seconds === null || seconds === undefined ? '—' : units.duration(seconds).text,
    /** For a chart axis, which needs the number and the unit apart. */
    depthParts: (metres: number) => units.depth(metres, prefs),
  };
}

export const withUnits = async (): Promise<Units> => formatters(await loadUnits());

import type { DiveObservation } from '@mydivelog/domain';

/**
 * Flattens an observation into the field map the merge engine resolves over.
 *
 * The paths here are the same ones `DiveFieldProvenance.fieldPath` records, so
 * a provenance row can be read back and shown against the field it decided.
 */
export function observationFields(o: DiveObservation): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const set = (path: string, value: unknown): void => {
    if (value !== undefined) fields[path] = value;
  };

  set('startTimeLocal', o.startTime.local);
  set('startTimeUtc', o.startTime.utc);
  set('tzOffsetMinutes', o.startTime.offsetMinutes);
  set('durationS', o.durationS);
  set('maxDepthM', o.maxDepthM);
  set('avgDepthM', o.avgDepthM);
  set('site.name', o.site?.name);
  set('site.lat', o.site?.lat);
  set('site.lon', o.site?.lon);
  set('site.altitudeM', o.site?.altitudeM);
  set('site.regionHint', o.site?.regionHint);
  set('tags', o.tags);
  set('gases', o.gases);
  set('tanks', o.tanks);
  set('gear', o.gear?.raw);
  set('buddies', o.buddies);
  set('waterTempMinC', o.waterTempMinC);
  set('airTempC', o.airTempC);
  set('visibilityM', o.visibilityM);
  set('weightKg', o.weightKg);
  set('waterType', o.waterType);
  set('rating', o.rating);
  set('notes', o.notes);
  set('diveNumber', o.diveNumber);
  set('profile', o.profile);
  return fields;
}

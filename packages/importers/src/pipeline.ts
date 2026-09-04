import {
  assignBatch,
  mergeDive,
  selectedValues,
  type DiveObservation,
  type MatchCandidate,
  type MergedDive,
} from '@mydivelog/domain';

/**
 * Stages 3 to 6 wired together, without touching a database.
 *
 * Commit is deliberately not here. This runs parse → match → merge and hands
 * back what *would* be written, which is what makes the whole path testable
 * against real files and what the review screen will show a diver before
 * anything is persisted.
 */

/** A dive as the pipeline knows it: a set of sources and their resolution. */
export type PipelineDive = {
  /** Stable within a run, not a database id. */
  key: string;
  sources: PipelineSource[];
  merged: MergedDive;
  values: Record<string, unknown>;
};

export type PipelineSource = {
  sourceId: string;
  sourceKind: string;
  sourceRef?: string;
  recordedAt: Date;
};

export type PipelineResult = {
  dives: PipelineDive[];
  created: number;
  mergedInto: number;
  needsReview: { sourceKind: string; index: number; note?: string }[];
};

/** Flattens an observation into the field map the merge engine resolves over. */
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

/**
 * Which fields an instrument actually measured, rather than was told.
 *
 * Only gas so far: the computer reads oxygen from the analyser, while the
 * diver writes what they remember buying. Weight is deliberately absent —
 * a watch has no idea how much lead you wore, which is why this export writes
 * 0.0 for all 96 dives.
 */
const SENSED_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  uddf: ['gases', 'profile', 'waterTempMinC'],
};

export type RunInput = {
  /** In the order they should be applied; later batches see earlier dives. */
  batches: { sourceKind: string; observations: readonly DiveObservation[]; recordedAt?: Date }[];
};

export function runPipeline({ batches }: RunInput): PipelineResult {
  const dives: PipelineDive[] = [];
  const needsReview: PipelineResult['needsReview'] = [];
  let created = 0;
  let mergedInto = 0;

  for (const batch of batches) {
    const candidates: MatchCandidate[] = dives.map((dive) => toCandidate(dive));
    const assignments = assignBatch(batch.observations, candidates);

    for (const assignment of assignments) {
      const observation = batch.observations[assignment.observationIndex];
      if (!observation) continue;

      const source: PipelineSource = {
        sourceId: `${batch.sourceKind}-${assignment.observationIndex}`,
        sourceKind: batch.sourceKind,
        ...(observation.sourceRef === undefined ? {} : { sourceRef: observation.sourceRef }),
        recordedAt: observation.startTime.utc ?? observation.startTime.local ?? new Date(0),
      };

      if (assignment.outcome.decision === 'merge') {
        const target = dives.find((d) => d.key === assignment.outcome.best?.candidateId);
        if (target) {
          target.sources.push(source);
          recompute(target, batch.sourceKind, observation);
          mergedInto++;
          continue;
        }
      }

      if (assignment.outcome.decision === 'ambiguous') {
        needsReview.push({
          sourceKind: batch.sourceKind,
          index: assignment.observationIndex,
          ...(assignment.outcome.note === undefined ? {} : { note: assignment.outcome.note }),
        });
      }

      const dive: PipelineDive = {
        key: `dive-${dives.length}`,
        sources: [source],
        merged: { fields: {}, hasContestedFields: false, contestedFields: [] },
        values: {},
      };
      dives.push(dive);
      recompute(dive, batch.sourceKind, observation);
      created++;
    }
  }

  return { dives, created, mergedInto, needsReview };
}

/** Field maps are held per source so a merge can be recomputed from scratch. */
const fieldsBySource = new WeakMap<PipelineSource, Record<string, unknown>>();

function recompute(dive: PipelineDive, sourceKind: string, observation: DiveObservation): void {
  const source = dive.sources[dive.sources.length - 1];
  if (source) fieldsBySource.set(source, observationFields(observation));

  dive.merged = mergeDive(
    dive.sources.map((s) => ({
      sourceId: s.sourceId,
      sourceKind: s.sourceKind,
      recordedAt: s.recordedAt,
      fields: fieldsBySource.get(s) ?? {},
      sensedFields: SENSED_BY_KIND[s.sourceKind] ?? [],
    })),
  );
  dive.values = selectedValues(dive.merged);
  void sourceKind;
}

function toCandidate(dive: PipelineDive): MatchCandidate {
  const v = dive.values;
  const lat = v['site.lat'];
  const lon = v['site.lon'];
  const name = v['site.name'];
  const site =
    lat !== undefined || lon !== undefined || name !== undefined
      ? {
          ...(typeof name === 'string' ? { name } : {}),
          ...(typeof lat === 'number' ? { lat } : {}),
          ...(typeof lon === 'number' ? { lon } : {}),
        }
      : undefined;

  return {
    id: dive.key,
    ...(v['startTimeUtc'] instanceof Date ? { startTimeUtc: v['startTimeUtc'] } : {}),
    ...(v['startTimeLocal'] instanceof Date ? { startTimeLocal: v['startTimeLocal'] } : {}),
    ...(typeof v['durationS'] === 'number' ? { durationS: v['durationS'] } : {}),
    ...(typeof v['maxDepthM'] === 'number' ? { maxDepthM: v['maxDepthM'] } : {}),
    ...(site ? { site } : {}),
    ...(Array.isArray(v['gases']) ? { gases: v['gases'] as { o2Fraction: number }[] } : {}),
    sourceRefs: dive.sources.flatMap((s) => (s.sourceRef ? [s.sourceRef] : [])),
  };
}

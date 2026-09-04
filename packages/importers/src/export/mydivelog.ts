import { emptyObservation, type DiveObservation } from '@mydivelog/domain';
import type { ExportableDive, Logbook } from './types.ts';

/**
 * MyDiveLog JSON — the full-fidelity format.
 *
 * Its job is to lose nothing, which makes it the backup format, the migration
 * format, and the one the round-trip test uses. If a logbook cannot survive
 * export and re-import unchanged, the data model has a hole in it, and the
 * round trip is how that hole gets found before a diver does.
 */

export const MYDIVELOG_FORMAT = 'mydivelog-logbook-v1';
export const MYDIVELOG_SOURCE_KIND = 'mydivelog';

export type MydivelogExport = {
  format: typeof MYDIVELOG_FORMAT;
  version: 1;
  exportedAt: string;
  dives: SerializedDive[];
};

type SerializedDive = Omit<
  ExportableDive,
  'startTimeLocal' | 'startTimeUtc' | 'sources' | 'profile'
> & {
  startTimeLocal?: string;
  startTimeUtc?: string;
  profile?: { timeS?: number[]; depthM?: number[]; tempC?: number[]; pressureBar?: number[] };
  sources?: { sourceKind: string; sourceRef?: string; recordedAt?: string }[];
};

export function exportMydivelog(logbook: Logbook, exportedAt = new Date()): MydivelogExport {
  return {
    format: MYDIVELOG_FORMAT,
    version: 1,
    exportedAt: exportedAt.toISOString(),
    dives: logbook.dives.map(serializeDive),
  };
}

function serializeDive(dive: ExportableDive): SerializedDive {
  const { startTimeLocal, startTimeUtc, sources, profile, ...rest } = dive;
  return {
    ...prune(rest),
    ...(startTimeLocal ? { startTimeLocal: startTimeLocal.toISOString() } : {}),
    ...(startTimeUtc ? { startTimeUtc: startTimeUtc.toISOString() } : {}),
    ...(profile
      ? {
          profile: {
            ...(profile.timeS ? { timeS: [...profile.timeS] } : {}),
            ...(profile.depthM ? { depthM: [...profile.depthM] } : {}),
            ...(profile.tempC ? { tempC: [...profile.tempC] } : {}),
            ...(profile.pressureBar ? { pressureBar: [...profile.pressureBar] } : {}),
          },
        }
      : {}),
    ...(sources
      ? {
          sources: sources.map((s) => ({
            sourceKind: s.sourceKind,
            ...(s.sourceRef === undefined ? {} : { sourceRef: s.sourceRef }),
            ...(s.recordedAt ? { recordedAt: s.recordedAt.toISOString() } : {}),
          })),
        }
      : {}),
  };
}

/**
 * Drops undefined rather than writing `null`.
 *
 * Absent has to survive a round trip as absent. A `null` in the file comes
 * back as a value, and a value is what beats a real reading from another
 * source during merge — the same trap as the `leadquantity` sentinel, arriving
 * this time through our own export.
 */
function prune<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export type MydivelogParseResult = {
  observations: DiveObservation[];
  fileIssues: { severity: 'error' | 'warning' | 'info'; code: string; message: string }[];
};

/**
 * Reads a MyDiveLog export back into observations.
 *
 * Round-tripping through the pipeline rather than straight into the database
 * is deliberate: an export re-imported has to go through the same matching and
 * merge as any other file, so restoring a backup onto an existing logbook
 * behaves like an import and not like an overwrite.
 */
export function parseMydivelog(json: string): MydivelogParseResult {
  let doc: MydivelogExport;
  try {
    doc = JSON.parse(json) as MydivelogExport;
  } catch (err) {
    return {
      observations: [],
      fileIssues: [
        {
          severity: 'error',
          code: 'unparseable_json',
          message: `Not readable JSON: ${String(err)}`,
        },
      ],
    };
  }

  if (doc?.format !== MYDIVELOG_FORMAT) {
    return {
      observations: [],
      fileIssues: [
        {
          severity: 'error',
          code: 'not_mydivelog',
          message: `Expected format "${MYDIVELOG_FORMAT}", found "${String(doc?.format)}".`,
        },
      ],
    };
  }

  const dives = Array.isArray(doc.dives) ? doc.dives : [];
  return {
    observations: dives.map((dive) => toObservation(dive)),
    fileIssues:
      dives.length === 0
        ? [{ severity: 'warning' as const, code: 'no_dives', message: 'This export has no dives.' }]
        : [],
  };
}

function toObservation(dive: SerializedDive): DiveObservation {
  const o = emptyObservation(MYDIVELOG_SOURCE_KIND, dive, dive.startTimeLocal ?? '');

  // This logbook's own id first, the originating file's id second. Either
  // makes a re-import an identity decision rather than a scoring one, which
  // is what stops a restored backup from duplicating the dives it restores.
  const ref = dive.ref ?? dive.sources?.find((s) => s.sourceRef !== undefined)?.sourceRef;
  if (ref !== undefined) o.sourceRef = ref;

  o.startTime = {
    raw: dive.startTimeLocal ?? '',
    ...(dive.startTimeLocal ? { local: new Date(dive.startTimeLocal) } : {}),
    ...(dive.startTimeUtc ? { utc: new Date(dive.startTimeUtc) } : {}),
    ...(dive.tzOffsetMinutes === undefined ? {} : { offsetMinutes: dive.tzOffsetMinutes }),
  };

  const copy = <K extends keyof DiveObservation>(key: K, value: DiveObservation[K]): void => {
    if (value !== undefined) o[key] = value;
  };

  copy('diveNumber', dive.diveNumber);
  copy('durationS', dive.durationS);
  copy('maxDepthM', dive.maxDepthM);
  copy('avgDepthM', dive.avgDepthM);
  copy('waterTempMinC', dive.waterTempMinC);
  copy('airTempC', dive.airTempC);
  copy('visibilityM', dive.visibilityM);
  copy('weightKg', dive.weightKg);
  copy('rating', dive.rating);
  copy('notes', dive.notes);
  copy('tags', dive.tags);
  copy('buddies', dive.buddies);
  copy('gases', dive.gases);
  copy('profile', dive.profile);
  if (dive.waterType !== undefined) {
    o.waterType = dive.waterType as NonNullable<DiveObservation['waterType']>;
  }
  if (dive.site !== undefined) o.site = dive.site;
  if (dive.gear !== undefined) o.gear = { raw: dive.gear };

  return o;
}

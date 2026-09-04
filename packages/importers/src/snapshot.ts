import type { ProfileSeries } from '@mydivelog/domain';
import { parseCsv } from './tabular/csv.ts';
import { parseTabular } from './tabular/index.ts';
import { parseUddf } from './uddf/index.ts';
import { runPipeline } from './pipeline.ts';

/**
 * Builds the golden snapshot: both real seed files, parsed, matched and merged.
 *
 * This lives in the package rather than in `fixtures/scripts/` because the
 * golden test needs it, and a test that imports through the package's own
 * built `dist` makes the package's tests depend on its own build output. That
 * passed locally, where a stale `dist` happened to exist, and failed in CI
 * where nothing had built it yet.
 *
 * `fixtures/scripts/snapshot.mjs` is a thin CLI over this.
 *
 * File contents are passed in rather than read here, which keeps this package
 * free of filesystem access like the rest of it — and means the same function
 * serves the CLI, the test, and eventually the API.
 */

/** Every site in the seed fixtures is Caribbean. */
const resolveTz = (): number => -240;

export type SnapshotInput = { uddf: string; spreadsheet: string };

export function buildSnapshot(input: SnapshotInput) {
  const uddf = parseUddf(input.uddf, { resolveTz });
  const table = parseCsv(input.spreadsheet);
  const sheet = parseTabular(table.headers, table.rows);

  // Spreadsheet first, then the computer export — the order a diver would
  // actually do it, and the order that makes the watch's data land on dives
  // that already have names.
  const result = runPipeline({
    batches: [
      { sourceKind: 'spreadsheet', observations: sheet.observations },
      { sourceKind: 'uddf', observations: uddf.observations },
    ],
  });

  return {
    summary: {
      dives: result.dives.length,
      created: result.created,
      mergedInto: result.mergedInto,
      needsReview: result.needsReview.length,
      withTwoSources: result.dives.filter((d) => d.sources.length > 1).length,
      withProfile: result.dives.filter((d) => d.values['profile']).length,
      contested: result.dives.filter((d) => d.merged.hasContestedFields).length,
    },
    dives: result.dives
      .map((dive) => ({
        sources: dive.sources.map((s) => s.sourceKind).sort(),
        contested: dive.merged.contestedFields,
        values: presentable(dive.values),
      }))
      .sort((a, b) =>
        String(a.values['startTimeLocal'] ?? '').localeCompare(
          String(b.values['startTimeLocal'] ?? ''),
        ),
      ),
  };
}

/**
 * A profile is 38 to 208 samples and would bury the snapshot in numbers nobody
 * reads. Its shape is summarized instead — enough to catch a decoding
 * regression, little enough that the file stays reviewable by eye.
 */
function presentable(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === 'profile') {
      const series = value as ProfileSeries;
      out['profile'] = {
        samples: series.timeS?.length ?? 0,
        firstTimeS: series.timeS?.[0],
        lastTimeS: series.timeS?.at(-1),
        maxDepthM: round(Math.max(...(series.depthM ?? [0]))),
        hasTemperature: Array.isArray(series.tempC),
      };
      continue;
    }
    out[key] = value instanceof Date ? value.toISOString() : round(value);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Rounds to nine decimals. Unit conversion leaves noise — 26.49000000000001 °C
 * out of kelvin — and a snapshot that records it is a snapshot that breaks on
 * a compiler's floating-point decisions rather than on a behavior change.
 */
function round(value: unknown): unknown {
  if (typeof value === 'number') return Number(value.toFixed(9));
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)]));
  }
  return value;
}

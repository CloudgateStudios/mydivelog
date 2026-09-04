#!/usr/bin/env node
/**
 * Regenerates the golden snapshot from the committed fixtures.
 *
 *   node fixtures/scripts/snapshot.mjs
 *
 * The output is the merged result of both seed files: the single highest-value
 * test in the project, verified by hand once and asserted against on every
 * change to the import engine after that.
 *
 * Regenerating is not a way to make a failing test pass. A diff here means the
 * engine now merges differently, and that difference has to be read and
 * understood before it is committed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv, parseTabular, parseUddf, runPipeline } from '@mydivelog/importers';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');

/** Every site in the fixture is Caribbean. */
const resolveTz = () => -240;

export function buildSnapshot() {
  const uddf = parseUddf(read('fixtures/uddf-sample.uddf'), { resolveTz });
  const table = parseCsv(read('fixtures/spreadsheet-sample.csv'));
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
      withProfile: result.dives.filter((d) => d.values.profile).length,
      contested: result.dives.filter((d) => d.merged.hasContestedFields).length,
    },
    dives: result.dives
      .map((dive) => ({
        sources: dive.sources.map((s) => s.sourceKind).sort(),
        contested: dive.merged.contestedFields,
        values: presentable(dive.values),
      }))
      .sort((a, b) =>
        String(a.values.startTimeLocal ?? '').localeCompare(String(b.values.startTimeLocal ?? '')),
      ),
  };
}

/**
 * A profile is 38 to 208 samples and would bury the snapshot in numbers nobody
 * reads. Its shape is summarized instead — enough to catch a decoding
 * regression, little enough that the file stays reviewable by eye.
 */
function presentable(values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === 'profile') {
      out.profile = {
        samples: value.timeS?.length ?? 0,
        firstTimeS: value.timeS?.[0],
        lastTimeS: value.timeS?.at(-1),
        maxDepthM: round(Math.max(...(value.depthM ?? [0]))),
        hasTemperature: Array.isArray(value.tempC),
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
function round(value) {
  if (typeof value === 'number') return Number(value.toFixed(9));
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)]));
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = fileURLToPath(new URL('fixtures/expected/merged.json', root));
  writeFileSync(target, `${JSON.stringify(buildSnapshot(), null, 2)}\n`);
  console.log(`wrote ${target}`);
}

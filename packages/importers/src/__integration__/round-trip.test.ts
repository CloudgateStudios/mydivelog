import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../tabular/csv.ts';
import { parseTabular } from '../tabular/index.ts';
import { parseUddf } from '../uddf/index.ts';
import { runPipeline, type PipelineDive } from '../pipeline.ts';
import { exportCsv } from '../export/csv.ts';
import { exportMydivelog, parseMydivelog } from '../export/mydivelog.ts';
import { exportUddf } from '../export/uddf.ts';
import type { ExportableDive, Logbook } from '../export/types.ts';

/**
 * Round trip: export a logbook, import it into an empty one, compare.
 *
 * If a logbook cannot survive its own export, the data model has a hole — and
 * the round trip is how that hole gets found before a diver relying on a
 * backup does.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url)), 'utf8');

const merged = runPipeline({
  batches: [
    {
      sourceKind: 'spreadsheet',
      observations: (() => {
        const table = parseCsv(fixture('spreadsheet-sample.csv'));
        return parseTabular(table.headers, table.rows).observations;
      })(),
    },
    {
      sourceKind: 'uddf',
      observations: parseUddf(fixture('uddf-sample.uddf'), { resolveTz: () => -240 }).observations,
    },
  ],
});

/** The pipeline's field map, shaped for an exporter. */
const toExportable = (dive: PipelineDive): ExportableDive => {
  const v = dive.values;
  const num = (k: string): number | undefined => (typeof v[k] === 'number' ? v[k] : undefined);
  const str = (k: string): string | undefined => (typeof v[k] === 'string' ? v[k] : undefined);

  const site = {
    ...(str('site.name') === undefined ? {} : { name: str('site.name') as string }),
    ...(num('site.lat') === undefined ? {} : { lat: num('site.lat') as number }),
    ...(num('site.lon') === undefined ? {} : { lon: num('site.lon') as number }),
    ...(num('site.altitudeM') === undefined ? {} : { altitudeM: num('site.altitudeM') as number }),
    ...(str('site.regionHint') === undefined
      ? {}
      : { regionHint: str('site.regionHint') as string }),
  };

  return {
    ref: dive.key,
    ...(num('diveNumber') === undefined ? {} : { diveNumber: num('diveNumber') as number }),
    ...(v['startTimeLocal'] instanceof Date ? { startTimeLocal: v['startTimeLocal'] } : {}),
    ...(v['startTimeUtc'] instanceof Date ? { startTimeUtc: v['startTimeUtc'] } : {}),
    ...(num('tzOffsetMinutes') === undefined
      ? {}
      : { tzOffsetMinutes: num('tzOffsetMinutes') as number }),
    ...(num('durationS') === undefined ? {} : { durationS: num('durationS') as number }),
    ...(num('maxDepthM') === undefined ? {} : { maxDepthM: num('maxDepthM') as number }),
    ...(num('waterTempMinC') === undefined
      ? {}
      : { waterTempMinC: num('waterTempMinC') as number }),
    ...(num('airTempC') === undefined ? {} : { airTempC: num('airTempC') as number }),
    ...(num('visibilityM') === undefined ? {} : { visibilityM: num('visibilityM') as number }),
    ...(num('weightKg') === undefined ? {} : { weightKg: num('weightKg') as number }),
    ...(num('rating') === undefined ? {} : { rating: num('rating') as number }),
    ...(str('notes') === undefined ? {} : { notes: str('notes') as string }),
    ...(str('waterType') === undefined ? {} : { waterType: str('waterType') as string }),
    ...(str('gear') === undefined ? {} : { gear: str('gear') as string }),
    ...(Array.isArray(v['tags']) ? { tags: v['tags'] as string[] } : {}),
    ...(Array.isArray(v['buddies']) ? { buddies: v['buddies'] as string[] } : {}),
    ...(Array.isArray(v['gases'])
      ? { gases: v['gases'] as { o2Fraction: number; label?: string }[] }
      : {}),
    ...(v['profile'] ? { profile: v['profile'] as ExportableDive['profile'] } : {}),
    ...(Object.keys(site).length > 0 ? { site } : {}),
    sources: dive.sources.map((s) => ({
      sourceKind: s.sourceKind,
      ...(s.sourceRef === undefined ? {} : { sourceRef: s.sourceRef }),
      recordedAt: s.recordedAt,
    })),
  };
};

const logbook: Logbook = { dives: merged.dives.map(toExportable) };

describe('MyDiveLog JSON round trip', () => {
  const json = JSON.stringify(exportMydivelog(logbook));
  const reimported = parseMydivelog(json);

  it('reads back every dive', () => {
    expect(reimported.fileIssues).toEqual([]);
    expect(reimported.observations).toHaveLength(24);
  });

  it('produces the same logbook when re-imported into an empty one', () => {
    // The acceptance criterion. Not "similar" — the same values, dive for
    // dive, after a full pass back through parse, match and merge.
    const rebuilt = runPipeline({
      batches: [{ sourceKind: 'mydivelog', observations: reimported.observations }],
    });
    expect(rebuilt.dives).toHaveLength(24);

    const before = merged.dives.map((d) => comparable(d.values));
    const after = rebuilt.dives.map((d) => comparable(d.values));
    expect(after).toEqual(before);
  });

  it('keeps absent fields absent rather than writing null', () => {
    // A null comes back as a value, and a value beats a real reading from
    // another source during merge — the leadquantity trap, arriving through
    // our own export this time.
    expect(json).not.toContain(':null');

    // Two dives in the fixture have no depth recorded. They must come back
    // with no depth, not with zero.
    const withoutDepth = reimported.observations.filter((o) => o.maxDepthM === undefined);
    expect(withoutDepth).toHaveLength(2);
    expect(withoutDepth.every((o) => !('maxDepthM' in o))).toBe(true);
  });

  it('preserves profiles sample for sample', () => {
    const original = merged.dives.find((d) => d.values['profile']);
    const restored = reimported.observations.find((o) => o.profile);
    expect(restored?.profile?.timeS).toEqual(
      (original?.values['profile'] as { timeS: number[] }).timeS,
    );
    expect(restored?.profile?.depthM).toEqual(
      (original?.values['profile'] as { depthM: number[] }).depthM,
    );
  });

  it('preserves the repaired offset', () => {
    const withOffset = reimported.observations.filter((o) => o.startTime.offsetMinutes === -240);
    expect(withOffset).toHaveLength(6);
  });

  it('re-importing onto the existing logbook merges rather than duplicating', () => {
    // Restoring a backup onto a logbook that still has those dives must not
    // double it. The carried source ids make that deterministic.
    const rebuilt = runPipeline({
      batches: [
        { sourceKind: 'spreadsheet', observations: reimported.observations },
        { sourceKind: 'mydivelog', observations: reimported.observations },
      ],
    });
    expect(rebuilt.dives).toHaveLength(24);
  });

  it('rejects a file that is not a MyDiveLog export', () => {
    expect(parseMydivelog('{"format":"something-else"}').fileIssues[0]?.code).toBe('not_mydivelog');
    expect(parseMydivelog('not json').fileIssues[0]?.code).toBe('unparseable_json');
  });
});

/** Compares what a diver would see, not object identity. */
function comparable(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (key === 'profile') {
      const p = value as { timeS?: number[]; depthM?: number[] };
      out[key] = { samples: p.timeS?.length, maxDepth: Math.max(...(p.depthM ?? [0])) };
      continue;
    }
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

describe('UDDF export', () => {
  const xml = exportUddf(logbook);

  it('is readable by this project’s own UDDF importer', () => {
    const back = parseUddf(xml, { resolveTz: () => -240 });
    expect(back.fileIssues).toEqual([]);
    expect(back.observations).toHaveLength(24);
  });

  it('writes a real offset, not the bug that started all this', () => {
    // The seed file writes -00:04 meaning -04:00. Ours writes -04:00, and the
    // importer's own suspicion rule confirms it: nothing is flagged.
    expect(xml).toContain('-04:00');
    expect(xml).not.toMatch(/-00:0\d</);
    const back = parseUddf(xml);
    expect(back.observations.every((o) => o.startTime.offsetSuspect !== true)).toBe(true);
  });

  it('omits weight rather than writing zero', () => {
    // Writing 0.0 for an unknown weight is exactly the bug that made the seed
    // file's 96 dives claim no lead.
    const empty = exportUddf({ dives: [{ startTimeLocal: new Date('2026-03-06T19:07:42Z') }] });
    expect(empty).not.toContain('leadquantity');
  });

  it('round-trips depth and duration', () => {
    const back = parseUddf(xml, { resolveTz: () => -240 });
    const deepest = Math.max(...back.observations.map((o) => o.maxDepthM ?? 0));
    expect(deepest).toBeCloseTo(30.7848, 3);
    expect(back.observations.filter((o) => o.profile).length).toBe(6);
  });

  it('escapes a name that would otherwise break the document', () => {
    const xmlWithMarkup = exportUddf({
      dives: [{ startTimeLocal: new Date('2026-03-06T19:07:42Z'), site: { name: 'A & B <deep>' } }],
    });
    expect(xmlWithMarkup).toContain('A &amp; B &lt;deep&gt;');
    expect(parseUddf(xmlWithMarkup).fileIssues).toEqual([]);
  });
});

describe('CSV export', () => {
  const csv = exportCsv(logbook);

  it('is readable by this project’s own tabular importer', () => {
    const table = parseCsv(csv);
    expect(table.ragged).toEqual([]);
    expect(table.rows).toHaveLength(24);
  });

  it('quotes a site name containing a comma', () => {
    // `1,000 Steps` unquoted produces a file our own importer would read as
    // two columns, and would then create a site called `000 Steps`.
    expect(csv).toContain('"1,000 Steps"');
    const table = parseCsv(csv);
    const names = table.rows.map((r) => r['Dive Site']);
    expect(names).toContain('1,000 Steps');
    expect(names.some((n) => n?.startsWith('000'))).toBe(false);
  });

  it('quotes notes containing a comma or a quote', () => {
    const withNotes = exportCsv({
      dives: [{ notes: 'Saw a turtle, then a ray. She said "wow".' }],
    });
    const table = parseCsv(withNotes);
    expect(table.rows[0]?.['Notes']).toBe('Saw a turtle, then a ray. She said "wow".');
  });

  it('converts to imperial when asked', () => {
    const imperial = exportCsv(logbook, { units: 'imperial' });
    expect(imperial).toContain('Max Depth (ft)');
    expect(imperial).toContain('Water Temperature (F)');
    const table = parseCsv(imperial);
    const depths = table.rows.map((r) => Number(r['Max Depth (ft)'])).filter((d) => d > 0);
    expect(Math.max(...depths)).toBeCloseTo(101, 0);
  });

  it('leaves an absent value empty rather than zero', () => {
    const table = parseCsv(csv);
    const sparse = table.rows.find((r) => r['Max Depth (ft)'] === '' || r['Max Depth (m)'] === '');
    expect(sparse).toBeDefined();
  });
});

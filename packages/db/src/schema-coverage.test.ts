import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phase 1's acceptance criterion: every field in the two real seed files has a
 * home in the schema, verified field by field.
 *
 * This asserts it mechanically rather than by eye. Each source field is mapped
 * to the schema location that will hold it; the test fails if a fixture grows a
 * field nobody has placed, or if a mapped target disappears from the schema.
 */

const repoRoot = new URL('../../../', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, repoRoot)), 'utf8');

const schema = read('packages/db/prisma/schema.prisma');

/** "model Dive { ... }" -> the field names inside it. */
function fieldsOfModel(model: string): Set<string> {
  const m = schema.match(new RegExp(`\\nmodel ${model} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${model} not found in schema`);
  const names = new Set<string>();
  for (const line of (m[1] as string).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
    const name = t.split(/\s+/)[0];
    if (name) names.add(name);
  }
  return names;
}

/** Asserts "Model.field" exists, or that the target is a documented non-column. */
function assertTarget(target: string): void {
  if (target.startsWith('!')) return; // deliberately not stored; reason in the map
  const [model, field] = target.split('.');
  expect(fieldsOfModel(model as string), `${target}: model has no such field`).toContain(
    field as string,
  );
}

describe('the sample spreadsheet', () => {
  // column -> where it lands
  const MAPPING: Record<string, string> = {
    'Dive Number': 'Dive.diveNumber',
    Date: 'Dive.startTimeLocal',
    'Time In': 'Dive.startTimeLocal',
    'Dive Time': 'Dive.durationS',
    'Time Out': '!derived from startTimeLocal + durationS; never stored',
    'Running Total Time': '!a spreadsheet rollup, detected and dropped on import',
    'Max Depth (ft)': 'Dive.maxDepthM',
    'Air Temperature (F)': 'Dive.airTempC',
    'Water Temperature (F)': 'Dive.waterTempMinC',
    'Visibility (ft)': 'Dive.visibilityM',
    Location: 'Site.regionId',
    'Dive Site': 'Site.name',
    'Water Type': 'Dive.waterType',
    'Dive Type': 'DiveTag.tagId',
    Gas: 'GasMix.o2Fraction',
    'EAN %': 'GasMix.o2Fraction',
    Equipment: 'GearItem.name',
    'Weight (lbs)': 'Dive.weightKg',
    Notes: 'Dive.notes',
  };

  it('has every column mapped to a schema location', () => {
    const header = read('fixtures/spreadsheet-sample.csv').split('\n')[0] as string;
    // Quote-aware split: the fixture deliberately contains "1,000 Steps".
    const columns = (header.match(/("[^"]*"|[^,]+)/g) ?? []).map((c) => c.replace(/^"|"$/g, ''));

    expect(columns.length).toBeGreaterThan(10);
    for (const column of columns) {
      expect(MAPPING, `spreadsheet column "${column}" has no home in the schema`).toHaveProperty(
        column,
      );
    }
  });

  it('maps every column to a field that actually exists', () => {
    for (const target of Object.values(MAPPING)) assertTarget(target);
  });
});

describe('the sample UDDF export', () => {
  const MAPPING: Record<string, string> = {
    'site/name': 'Site.name',
    'site/geography/location': 'Site.name',
    'site/geography/latitude': 'Site.latitude',
    'site/geography/longitude': 'Site.longitude',
    'site/geography/altitude': 'Site.altitudeM',
    'mix/name': 'GasMix.name',
    'mix/o2': 'GasMix.o2Fraction',
    'mix/n2': '!derived as 1 - o2 - he; storing it invites contradiction',
    'dive/informationbeforedive/datetime': 'Dive.startTimeUtc',
    'dive/informationbeforedive/altitude': 'Dive.altitudeM',
    'dive/informationbeforedive/link': 'Dive.siteId',
    'dive/informationafterdive/diveduration': 'Dive.durationS',
    'dive/informationafterdive/greatestdepth': 'Dive.maxDepthM',
    'dive/informationafterdive/lowesttemperature': 'Dive.waterTempMinC',
    'dive/informationafterdive/rating/ratingvalue': 'Dive.rating',
    'dive/informationafterdive/equipmentused/leadquantity': 'Dive.weightKg',
    'dive/informationafterdive/equipmentused/link': 'DiveTank.id',
    'dive/tankdata/link': 'DiveTank.gasMixId',
    'dive/samples/waypoint/depth': 'DiveProfile.storageKey',
    'dive/samples/waypoint/divetime': 'DiveProfile.storageKey',
    'dive/samples/waypoint/temperature': 'DiveProfile.storageKey',
    'dive/samples/waypoint/divemode': 'Dive.diveMode',
    'dive/samples/waypoint/switchmix': 'DiveTank.gasMixId',
    'generator/version': 'DiveSource.rawPayload',
    'generator/datetime': 'DiveSource.recordedAt',
    'generator/manufacturer/contact/homepage': 'DiveSource.rawPayload',
  };

  /** Element paths present in the fixture, relative to the interesting roots. */
  function uddfPaths(): Set<string> {
    const xml = read('fixtures/uddf-sample.uddf');
    const stack: string[] = [];
    const paths = new Set<string>();
    for (const m of xml.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*?)(\/?)>/gi)) {
      const [, closing, tag, , selfClosing] = m;
      if (closing) {
        stack.pop();
        continue;
      }
      stack.push(tag as string);
      // Match on segments, not substrings: indexOf('site/') would find the
      // "site" inside "divesite" and yield paths like "site/site/name".
      const roots = ['site', 'mix', 'dive', 'generator'];
      const start = stack.findIndex((segment) => roots.includes(segment));
      if (start !== -1) paths.add(stack.slice(start).join('/'));
      if (selfClosing) stack.pop();
    }
    return paths;
  }

  it('has every element mapped to a schema location', () => {
    const all = [...uddfPaths()];
    // Only leaves carry values. A path is a container if another path extends
    // it, e.g. "dive/samples/waypoint" is a container for ".../depth".
    const paths = all.filter(
      (p) => p.includes('/') && !all.some((other) => other.startsWith(`${p}/`)),
    );
    expect(paths.length).toBeGreaterThan(15);

    const unmapped = paths.filter((p) => !(p in MAPPING));
    expect(unmapped, `UDDF elements with no home in the schema: ${unmapped.join(', ')}`).toEqual(
      [],
    );
  });

  it('maps every element to a field that actually exists', () => {
    for (const target of Object.values(MAPPING)) assertTarget(target);
  });
});

describe('the schema keeps the promises the data model makes', () => {
  it('stores the three time fields separately', () => {
    const dive = fieldsOfModel('Dive');
    expect(dive).toContain('startTimeUtc');
    expect(dive).toContain('startTimeLocal');
    expect(dive).toContain('tzOffsetMinutes');
  });

  it('names units on every measurement column', () => {
    const dive = [...fieldsOfModel('Dive')];
    const measurements = dive.filter((f) =>
      /^(maxDepth|avgDepth|airTemp|waterTempMin|waterTempMax|visibility|weight|altitude|duration|surfaceInterval)/.test(
        f,
      ),
    );
    expect(measurements.length).toBeGreaterThan(6);
    for (const f of measurements) {
      expect(f, `${f} does not name its unit`).toMatch(/(M|C|S|Kg)$/);
    }
  });

  it('enforces dive number uniqueness with a partial index, not a constraint', () => {
    // A plain @@unique would let a soft-deleted dive squat its number forever
    // and make renumbering collide with tombstones, so the index lives in SQL
    // and is deliberately absent from the Prisma model.
    const model = schema.match(/\nmodel Dive \{([\s\S]*?)\n\}/)![1] as string;
    expect(model).not.toMatch(/@@unique\(\[userId, diveNumber\]/);
    expect(model).toMatch(/diveNumber Int(?!\?)/); // required

    const migrations = read(
      'packages/db/prisma/migrations/20260904013418_dive_number_required/migration.sql',
    );
    expect(migrations).toMatch(/CREATE UNIQUE INDEX "dives_userId_diveNumber_live_key"/);
    expect(migrations).toMatch(/WHERE "deletedAt" IS NULL/);
  });

  it('gives every user-owned table a tombstone', () => {
    for (const model of ['Dive', 'Site', 'Trip', 'GearItem', 'Buddy', 'Certification']) {
      expect(fieldsOfModel(model), `${model} has no deletedAt`).toContain('deletedAt');
    }
  });

  it('keeps profile samples out of Postgres', () => {
    const profile = fieldsOfModel('DiveProfile');
    expect(profile).toContain('storageKey');
    expect(profile).not.toContain('samples');
  });
});

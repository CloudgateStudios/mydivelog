/**
 * The import pipeline through the API layer, against a real database.
 *
 *   pnpm services:up && pnpm --filter @mydivelog/api test:integration
 *
 * The engine is proven by the golden fixture; this proves the wiring. Both of
 * the real seed files go in through the same path a client uses, and the
 * logbook that comes out is the one the golden snapshot describes.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient, userScope, type UserScope } from '@mydivelog/db';
import { ImportsService } from './imports.service.ts';
import { ExportsService } from './exports.service.ts';
import { StorageService } from '../storage/storage.service.ts';
import { StorageConfig } from '../storage/storage.config.ts';

const prisma = createPrismaClient();

// Unconfigured on purpose. Object storage is exercised by its own tests; here
// it would only make the suite depend on MinIO being up to prove something
// about parsing and matching.
const storage = new StorageService(new StorageConfig({}));
const imports = new ImportsService(storage);
const exports = new ExportsService(storage);

const bytes = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url))),
  );

let userId: string;
let scope: UserScope;

beforeEach(async () => {
  userId = randomUUID();
  scope = userScope(userId);
  await prisma.user.create({ data: { id: userId, email: `itest-${userId}@mydivelog.invalid` } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const importFile = async (name: string): Promise<string> =>
  imports.create(scope, name, bytes(name));

// Takes a scope rather than closing over one: two of these tests import as a
// second user, and a helper that quietly used the first made them fail with a
// not-found that looked like the behaviour under test.
const commitAll = async (batchId: string, as: UserScope = scope) => {
  const batch = await imports.get(as, batchId);
  // Accept whatever the engine proposed, the way a diver clicking through a
  // review with no changes would.
  for (const row of batch.rows) {
    if (row.decision !== 'pending') continue;
    await imports.updateRow(as, batchId, row.rowIndex, 'create');
  }
  return imports.commit(as, batchId);
};

/** ProblemException's own message is always 'Problem Exception'; the reason is in the detail. */
const detailOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    const response = (err as { getResponse?: () => unknown }).getResponse?.();
    return String((response as { detail?: string } | undefined)?.detail ?? err);
  }
  throw new Error('expected the call to fail, and it did not');
};

describe('importing the real spreadsheet', () => {
  it('parses every row and proposes to create each one', async () => {
    const batchId = await importFile('spreadsheet-sample.csv');
    const batch = await imports.get(scope, batchId);

    expect(batch.status).toBe('review');
    expect(batch.sourceKind).toBe('spreadsheet');
    expect(batch.rows).toHaveLength(24);
    expect(batch.rows.every((r) => r.decision === 'create')).toBe(true);
  });

  it('writes nothing to the logbook before commit', async () => {
    // An import is a staged pipeline with human review, never a direct write.
    await importFile('spreadsheet-sample.csv');
    expect(await prisma.dive.count({ where: { userId } })).toBe(0);
  });

  it('creates the dives on commit', async () => {
    const batchId = await importFile('spreadsheet-sample.csv');
    const result = await commitAll(batchId);

    expect(result.created).toHaveLength(24);
    expect(await prisma.dive.count({ where: { userId } })).toBe(24);
  });
});

describe('importing the computer export onto an existing logbook', () => {
  it('merges the overlap instead of duplicating it', async () => {
    // The whole product, through the API: 24 rows and 6 computer dives make
    // 24 dives, not 30.
    await commitAll(await importFile('spreadsheet-sample.csv'));

    const uddfBatch = await importFile('uddf-sample.uddf');
    const batch = await imports.get(scope, uddfBatch);
    expect(batch.sourceKind).toBe('uddf');
    expect(batch.rows).toHaveLength(6);

    // Every one of them merges: the offsets are repaired, so time of day is
    // trustworthy and the six dives are recognised as dives already logged.
    expect(batch.rows.every((r) => r.decision === 'merge')).toBe(true);

    // Above the threshold, not at it. These sat at exactly 0.80 while the pure
    // pipeline scored them 0.85, because the candidate builder never carried
    // gases and the gas signal could not fire. Both merged, so nothing looked
    // wrong — which is the point of asserting the margin.
    expect(batch.rows.every((r) => (r.matchScore ?? 0) > 0.8)).toBe(true);

    const result = await commitAll(uddfBatch);
    expect(result.merged).toHaveLength(6);
    expect(result.created).toHaveLength(0);
    expect(await prisma.dive.count({ where: { userId } })).toBe(24);
  });

  it('gives the merged dives their profiles and the instrument’s depth', async () => {
    await commitAll(await importFile('spreadsheet-sample.csv'));
    await commitAll(await importFile('uddf-sample.uddf'));

    const withProfiles = await prisma.dive.count({ where: { userId, hasProfile: true } });
    expect(withProfiles).toBe(6);

    const bonaire = await prisma.dive.findFirst({
      where: { userId },
      orderBy: { startTimeUtc: 'desc' },
      include: { site: true },
    });
    // 14.099043 from the computer, not 14.0208 (46 ft rounded by hand), and a
    // site that is both named and located.
    expect(bonaire?.maxDepthM).toBeCloseTo(14.099043, 6);
    expect(bonaire?.site?.name).toBe('Angel City');
    expect(bonaire?.site?.latitude).not.toBeNull();
    expect(bonaire?.tzOffsetMinutes).toBe(-240);
  });

  it('corrects every malformed offset, corroborated by the site', async () => {
    // Unwired, the resolver left all six dives suspect and every row pending —
    // correct, but it meant the product's headline behaviour needed six manual
    // confirmations out of the box.
    const batchId = await importFile('uddf-sample.uddf');
    const batch = await imports.get(scope, batchId);

    const normalizations = batch.rows.flatMap(
      (r) =>
        r.normalizations as {
          confidence: string;
          to: unknown;
        }[],
    );
    expect(normalizations).toHaveLength(6);
    expect(normalizations.every((n) => n.confidence === 'high')).toBe(true);
    expect(normalizations.every((n) => n.to === -240)).toBe(true);
    // Not asserting `merge` here: this test imports into an empty logbook, so
    // there is nothing to merge onto. What matters is that the offsets are
    // repaired with high confidence rather than left suspect — the case where
    // that turns into a merge is the test above.
    expect(batch.rows.every((r) => r.decision === 'create')).toBe(true);
  });

  it('records what it changed and what it could not read', async () => {
    const batchId = await importFile('uddf-sample.uddf');
    const batch = await imports.get(scope, batchId);
    const stats = batch.stats as { parsed: number; normalized: number; issues: number };

    expect(stats.parsed).toBe(6);
    expect(stats.normalized).toBe(6);
    // The leadquantity sentinel, dropped on every dive and reported as info.
    expect(stats.issues).toBeGreaterThanOrEqual(6);
  });
});

describe('re-uploading the same file', () => {
  it('returns the batch that already exists rather than a second review', async () => {
    const first = await importFile('spreadsheet-sample.csv');
    const second = await importFile('spreadsheet-sample.csv');
    expect(second).toBe(first);
    expect(await prisma.importBatch.count({ where: { userId } })).toBe(1);
  });
});

describe('review decisions', () => {
  it('refuses to merge onto a dive that is not this user’s', async () => {
    // A dive id from a review screen is not a capability.
    const other = randomUUID();
    await prisma.user.create({ data: { id: other, email: `itest-${other}@mydivelog.invalid` } });
    const theirScope = userScope(other);
    const theirBatch = await imports.create(
      theirScope,
      'spreadsheet-sample.csv',
      bytes('spreadsheet-sample.csv'),
    );
    const theirs = await commitAll(theirBatch, theirScope);

    const mine = await importFile('uddf-sample.uddf');
    await expect(
      imports.updateRow(scope, mine, 0, 'merge', theirs.created[0] as string),
    ).rejects.toThrow();
  });

  it('skips a row the diver rejected', async () => {
    const batchId = await importFile('spreadsheet-sample.csv');
    await imports.updateRow(scope, batchId, 0, 'skip');
    const result = await commitAll(batchId);

    expect(result.skipped).toBe(1);
    expect(await prisma.dive.count({ where: { userId } })).toBe(23);
  });

  it('refuses to change a committed import', async () => {
    const batchId = await importFile('spreadsheet-sample.csv');
    await commitAll(batchId);
    expect(await detailOf(() => imports.updateRow(scope, batchId, 0, 'skip'))).toContain(
      'committed',
    );
  });

  it('refuses to commit twice', async () => {
    const batchId = await importFile('spreadsheet-sample.csv');
    await commitAll(batchId);
    expect(await detailOf(() => imports.commit(scope, batchId))).toContain(
      'already been committed',
    );
  });
});

describe('revert through the service', () => {
  it('undoes a committed import', async () => {
    const batchId = await importFile('spreadsheet-sample.csv');
    await commitAll(batchId);

    const result = await imports.revert(scope, batchId);
    expect(result.deleted).toHaveLength(24);
    expect(await prisma.dive.count({ where: { userId } })).toBe(0);
  });

  it('refuses to revert an import that was never committed', async () => {
    const batchId = await importFile('spreadsheet-sample.csv');
    expect(await detailOf(() => imports.revert(scope, batchId))).toContain(
      'only a committed import',
    );
  });
});

describe('unreadable files', () => {
  it('fails the batch rather than the request, and says why', async () => {
    // A diver gets a review screen that says what went wrong, not a 500.
    const batchId = await imports.create(
      scope,
      'notes.txt',
      new TextEncoder().encode('just prose'),
    );
    const batch = await imports.get(scope, batchId);
    expect(batch.status).toBe('failed');

    // Asserting the error is truthy is not enough: the first version of this
    // stored `ProblemException: Problem Exception`, which is truthy and tells
    // a diver nothing. It has to be a sentence about their file.
    expect(batch.error).toContain('format');
    expect(batch.error).not.toContain('Exception');
  });

  it('fails a truncated UDDF rather than importing an empty logbook', async () => {
    const full = new TextDecoder().decode(bytes('uddf-sample.uddf'));
    const batchId = await imports.create(
      scope,
      'truncated.uddf',
      new TextEncoder().encode(full.slice(0, full.length / 2)),
    );
    expect((await imports.get(scope, batchId)).status).toBe('failed');
  });
});

describe('export', () => {
  it('reads the logbook back out as MyDiveLog JSON', async () => {
    await commitAll(await importFile('spreadsheet-sample.csv'));
    const result = await exports.export(scope, 'mydivelog', 'metric');

    const parsed = JSON.parse(result.body) as { dives: { ref: string }[] };
    expect(parsed.dives).toHaveLength(24);
    expect(parsed.dives.every((d) => typeof d.ref === 'string')).toBe(true);
    expect(result.contentType).toContain('application/json');
  });

  it('exports UDDF and CSV', async () => {
    await commitAll(await importFile('spreadsheet-sample.csv'));

    const uddf = await exports.export(scope, 'uddf', 'metric');
    expect(uddf.body).toContain('<uddf');
    expect(uddf.fileName).toMatch(/\.uddf$/);

    const csv = await exports.export(scope, 'csv', 'imperial');
    expect(csv.body.split('\n')).toHaveLength(26); // header + 24 dives + trailing
    expect(csv.body).toContain('Max Depth (ft)');
  });

  it('exports an empty logbook without failing', async () => {
    const result = await exports.export(scope, 'mydivelog', 'metric');
    expect((JSON.parse(result.body) as { dives: unknown[] }).dives).toEqual([]);
  });

  it('never exports another user’s dives', async () => {
    const other = randomUUID();
    await prisma.user.create({ data: { id: other, email: `itest-${other}@mydivelog.invalid` } });
    const theirScope = userScope(other);
    await commitAll(
      await imports.create(theirScope, 'spreadsheet-sample.csv', bytes('spreadsheet-sample.csv')),
      theirScope,
    );

    const mine = await exports.export(scope, 'mydivelog', 'metric');
    expect((JSON.parse(mine.body) as { dives: unknown[] }).dives).toEqual([]);
  });
});

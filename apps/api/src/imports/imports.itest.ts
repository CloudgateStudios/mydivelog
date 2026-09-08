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
import { templateCsv, templateXlsx } from '@mydivelog/importers';
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

/**
 * The same log, in the file format it actually arrives in.
 *
 * Every Excel workbook was refused with "This file is not in a format
 * MyDiveLog can read yet" — detection read a decoded string, and an .xlsx is a
 * ZIP archive, so it was binary noise that matched nothing. The mapping had
 * always been fine; nothing could get a workbook as far as it.
 */
describe('importing the same log as an Excel workbook', () => {
  it('reads it, and reaches review like any other file', async () => {
    const batchId = await importFile('spreadsheet-sample.xlsx');
    const batch = await imports.get(scope, batchId);

    expect(batch.status).toBe('review');
    expect(batch.sourceKind).toBe('xlsx');
    expect(batch.rows).toHaveLength(24);
    expect(batch.rows.every((r) => r.decision === 'create')).toBe(true);
  });

  it('produces the same logbook the CSV of those rows produces', async () => {
    // The claim worth making: which file format the diver had changes nothing
    // about what ends up in their logbook.
    const fromWorkbook = await commitAll(await importFile('spreadsheet-sample.xlsx'));
    const workbookDives = await prisma.dive.findMany({
      where: { userId },
      orderBy: { startTimeUtc: 'asc' },
      select: { startTimeUtc: true, maxDepthM: true, durationS: true, diveNumber: true },
    });

    // A second diver, importing the CSV of the same rows.
    const otherId = randomUUID();
    const other = userScope(otherId);
    await prisma.user.create({
      data: { id: otherId, email: `itest-${otherId}@mydivelog.invalid` },
    });
    await commitAll(
      await imports.create(other, 'spreadsheet-sample.csv', bytes('spreadsheet-sample.csv')),
      other,
    );
    const csvDives = await prisma.dive.findMany({
      where: { userId: otherId },
      orderBy: { startTimeUtc: 'asc' },
      select: { startTimeUtc: true, maxDepthM: true, durationS: true, diveNumber: true },
    });

    expect(fromWorkbook.created).toHaveLength(24);
    expect(workbookDives).toEqual(csvDives);
  });

  it('is recognised from its content, not its name', async () => {
    // A diver who saved it as .xls, or whose browser sent no extension at all,
    // has a file we can read either way.
    const batchId = await imports.create(scope, 'divelog.xls', bytes('spreadsheet-sample.xlsx'));
    expect((await imports.get(scope, batchId)).sourceKind).toBe('xlsx');
  });

  it('fails a workbook with no headings rather than importing nothing quietly', async () => {
    // A .docx renamed, or a workbook of notes. It has to say which.
    const notAWorkbook = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const batchId = await imports.create(scope, 'broken.xlsx', notAWorkbook);
    const batch = await imports.get(scope, batchId);
    expect(batch.status).toBe('failed');
    expect(batch.error).toMatch(/workbook/i);
    expect(batch.error).not.toContain('Exception');
  });
});

/**
 * A dive number means "the nth dive I have done".
 *
 * It was assigned in the order rows appeared in the file, and the sample UDDF
 * is newest-first — so the most recent dive became number 1 and the oldest
 * became the highest, which is exactly backwards and is what a diver sees
 * first when they open their logbook.
 */
describe('dive numbering', () => {
  const inDateOrder = async () => {
    const dives = await prisma.dive.findMany({
      where: { userId, deletedAt: null },
      orderBy: { startTimeUtc: 'asc' },
      select: { diveNumber: true, startTimeUtc: true },
    });
    return dives;
  };

  it('numbers a newest-first file oldest-first', async () => {
    await commitAll(await importFile('uddf-sample.uddf'));
    const dives = await inDateOrder();

    expect(dives.length).toBeGreaterThan(1);
    expect(dives[0]?.diveNumber).toBe(1);
    expect(dives.at(-1)?.diveNumber).toBe(dives.length);
    // Every step forwards in time is a step up in number.
    expect(dives.every((d, i) => i === 0 || d.diveNumber > (dives[i - 1]?.diveNumber ?? 0))).toBe(
      true,
    );
  });

  it('keeps the numbers the diver wrote in their own spreadsheet', async () => {
    // A dive number is not ours to invent. Somebody numbered fourteen years of
    // diving by hand and their paper logbook says the same; replacing that
    // with numbers of our own throws away a record we were asked to preserve.
    //
    // The fixture's own numbers are 1 2 3 10 13 15 x x 96 97 182 … 195 — with
    // gaps, because dives were left out of the redaction. The gaps have to
    // survive too: a number that is not 1..N is not a defect.
    const result = await commitAll(await importFile('spreadsheet-sample.csv'));

    const numbers = (
      await prisma.dive.findMany({
        where: { userId },
        select: { diveNumber: true },
        orderBy: { diveNumber: 'asc' },
      })
    ).map((d) => d.diveNumber);

    expect(numbers).toContain(1);
    expect(numbers).toContain(195);
    // 1, 2, 3, 10 — not renumbered into a run.
    expect(numbers.slice(0, 4)).toEqual([1, 2, 3, 10]);
    expect(result.numberedFromFile).toBe(22);
  });

  it('numbers by date only the rows the file left blank', async () => {
    // Two of the fixture's rows have the letter x where a number should be.
    // Those cannot be honoured, and must not stop the other 22 from being.
    const result = await commitAll(await importFile('spreadsheet-sample.csv'));

    expect(result.numberedAutomatically).toBe(2);
    expect(result.numberedFromFile + result.numberedAutomatically).toBe(result.created.length);
    // Assigned above everything the file claimed, so nothing collides.
    const numbers = (
      await prisma.dive.findMany({ where: { userId }, select: { diveNumber: true } })
    ).map((d) => d.diveNumber);
    expect(numbers).toContain(196);
    expect(numbers).toContain(197);
  });

  it('never takes a number the diver is already using', async () => {
    // The uniqueness index is partial and real, so a collision is a failed
    // transaction rather than a cosmetic problem.
    //
    // The workbook holds the same 24 dives as the CSV, with the same numbers,
    // in a different file — so importing it after the CSV and forcing every
    // row to create asks for 24 numbers that are all already taken. An
    // identical *re-upload* cannot be used here: it short-circuits to the
    // batch that already exists, which is its own correct behaviour.
    await commitAll(await importFile('spreadsheet-sample.csv'));
    const before = await prisma.dive.count({ where: { userId } });

    const second = await imports.create(scope, 'same-dives.xlsx', bytes('spreadsheet-sample.xlsx'));
    for (const row of (await imports.get(scope, second)).rows) {
      await imports.updateRow(scope, second, row.rowIndex, 'create');
    }
    const result = await imports.commit(scope, second);

    const numbers = (
      await prisma.dive.findMany({ where: { userId }, select: { diveNumber: true } })
    ).map((d) => d.diveNumber);

    expect(numbers).toHaveLength(before + result.created.length);
    // Every number distinct — the property the index enforces, and the one a
    // second import is most likely to break.
    expect(new Set(numbers).size).toBe(numbers.length);
    // Not one of them could keep its number; all were already in use.
    expect(result.numberedFromFile).toBe(0);
  });

  it('appends a second import after the first, without renumbering it', async () => {
    await commitAll(await importFile('spreadsheet-sample.csv'));
    const before = await inDateOrder();

    await commitAll(await importFile('uddf-sample.uddf'));
    const after = await inDateOrder();

    // Nothing already in the logbook is touched by an import. The UDDF
    // overlaps the spreadsheet, so most of its dives merge rather than being
    // created, and the ones that are new are numbered above what was there.
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    expect(new Set(after.map((d) => d.diveNumber)).size).toBe(after.length);
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

/**
 * The blank sheet a diver with nothing to import starts from.
 *
 * The generator has its own tests; these are about the endpoint — that it
 * follows the diver's units, that "template" is not read as a batch id, and
 * above all that what it hands out comes back in.
 */
describe('the import template', () => {
  it('comes back in, with every column recognised', async () => {
    for (const format of ['xlsx', 'csv'] as const) {
      const file = format === 'csv' ? templateCsv('metric') : templateXlsx('metric');
      const bytes = typeof file === 'string' ? new TextEncoder().encode(file) : file;

      const batchId = await imports.create(scope, `template.${format}`, bytes);
      const batch = await imports.get(scope, batchId);

      expect(batch.status, format).toBe('review');
      expect(batch.rows, format).toHaveLength(1);
      // Reaching a proposal means every heading mapped and the row parsed.
      expect(batch.rows[0]?.decision, format).toBe('create');
    }
  });

  it('names nothing a diver could already have', async () => {
    // A plausible site on a plausible date is one the matcher will offer to
    // merge with a real dive, turning a blank template into a conflict to
    // resolve. It did, the first time this was tested end to end.
    await commitAll(await importFile('spreadsheet-sample.csv'));

    const batchId = await imports.create(scope, 'template.xlsx', templateXlsx('metric'));
    const batch = await imports.get(scope, batchId);
    expect(batch.rows[0]?.decision).toBe('create');
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

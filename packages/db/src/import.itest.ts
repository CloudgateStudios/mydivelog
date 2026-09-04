/**
 * Commit and revert against a real database.
 *
 *   pnpm services:up && pnpm --filter @mydivelog/db test:integration
 *
 * Revert is the reason these are integration tests rather than unit tests. It
 * has to restore a dive's exact prior state from provenance that survives in
 * Postgres, and a fake would be asserting that my model of the database is
 * self-consistent rather than that the database does this.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.ts';
import { createImportRepository, type CommitRow } from './repositories/import.repository.ts';
import { userScope } from './scope.ts';

const prisma = createPrismaClient();
const repo = createImportRepository(prisma);

let userId: string;
let scope: ReturnType<typeof userScope>;

const batch = async (sourceKind: string): Promise<string> => {
  const id = randomUUID();
  await prisma.importBatch.create({
    data: {
      id,
      userId,
      sourceKind,
      originalFileKey: `uploads/${id}`,
      originalFileName: `${sourceKind}.file`,
      fileSize: 1,
      checksum: id,
    },
  });
  return id;
};

const SHEET_TIME = new Date('2026-03-06T19:07:00Z');
const WATCH_TIME = new Date('2026-03-06T19:07:42Z');

const sheetRow = (over: Partial<CommitRow> = {}): CommitRow => ({
  rowIndex: 0,
  decision: 'create',
  sourceKind: 'spreadsheet',
  recordedAt: new Date('2026-03-06T00:00:00Z'),
  fields: {
    startTimeLocal: SHEET_TIME,
    startTimeUtc: SHEET_TIME,
    tzOffsetMinutes: -240,
    maxDepthM: 14.0208,
    weightKg: 10.886,
    notes: 'Saw an eagle ray.',
    visibilityM: 24.384,
  },
  ...over,
});

const watchRow = (diveId: string, over: Partial<CommitRow> = {}): CommitRow => ({
  rowIndex: 0,
  decision: 'merge',
  diveId,
  sourceKind: 'uddf',
  sourceRef: 'dive_69ab7a96dce6e40c7d3abe65',
  recordedAt: WATCH_TIME,
  fields: {
    startTimeLocal: WATCH_TIME,
    startTimeUtc: new Date('2026-03-06T23:07:42Z'),
    tzOffsetMinutes: -240,
    maxDepthM: 14.099043,
    durationS: 2776,
    waterTempMinC: 26.49,
  },
  ...over,
});

beforeEach(async () => {
  userId = randomUUID();
  scope = userScope(userId);
  await prisma.user.create({ data: { id: userId, email: `itest-${userId}@mydivelog.invalid` } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const diveOf = async (id: string) => prisma.dive.findUniqueOrThrow({ where: { id } });

describe('commit', () => {
  it('creates a dive and assigns it a number', async () => {
    const b = await batch('spreadsheet');
    const result = await repo.commit(scope, b, [sheetRow()]);

    expect(result.created).toHaveLength(1);
    const dive = await diveOf(result.created[0] as string);
    expect(dive.diveNumber).toBe(1);
    expect(dive.maxDepthM).toBeCloseTo(14.0208, 4);
    expect(dive.notes).toBe('Saw an eagle ray.');
  });

  it('writes provenance for every field the source asserted', async () => {
    const b = await batch('spreadsheet');
    const { created } = await repo.commit(scope, b, [sheetRow()]);
    const rows = await prisma.diveFieldProvenance.findMany({ where: { diveId: created[0] } });
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.isSelected)).toBe(true);
  });

  it('marks the batch committed', async () => {
    const b = await batch('spreadsheet');
    await repo.commit(scope, b, [sheetRow()]);
    const record = await prisma.importBatch.findUniqueOrThrow({ where: { id: b } });
    expect(record.status).toBe('committed');
    expect(record.committedAt).not.toBeNull();
  });

  it('resolves a merge by field class, not by whoever wrote last', async () => {
    const sheet = await batch('spreadsheet');
    const { created } = await repo.commit(scope, sheet, [sheetRow()]);
    const diveId = created[0] as string;

    const watch = await batch('uddf');
    await repo.commit(scope, watch, [watchRow(diveId)]);

    const dive = await diveOf(diveId);
    // Instrument wins the measurement, the diver keeps the subjective fields.
    expect(dive.maxDepthM).toBeCloseTo(14.099043, 6);
    expect(dive.durationS).toBe(2776);
    expect(dive.notes).toContain('eagle ray');
    expect(dive.visibilityM).toBeCloseTo(24.384, 3);
    expect(dive.weightKg).toBeCloseTo(10.886, 3);
  });

  it('keeps both assertions and marks which one is shown', async () => {
    const sheet = await batch('spreadsheet');
    const { created } = await repo.commit(scope, sheet, [sheetRow()]);
    const diveId = created[0] as string;
    const watch = await batch('uddf');
    await repo.commit(scope, watch, [watchRow(diveId)]);

    const depth = await prisma.diveFieldProvenance.findMany({
      where: { diveId, fieldPath: 'maxDepthM' },
    });
    expect(depth).toHaveLength(2);
    expect(depth.filter((d) => d.isSelected)).toHaveLength(1);
    // The losing value is retained, which is what makes revert possible.
    expect(depth.some((d) => Math.abs(Number(d.value) - 14.0208) < 1e-6)).toBe(true);
  });

  it('numbers a second dive after the first', async () => {
    const b = await batch('spreadsheet');
    const { created } = await repo.commit(scope, b, [
      sheetRow({ rowIndex: 0 }),
      sheetRow({ rowIndex: 1, fields: { ...sheetRow().fields, maxDepthM: 20 } }),
    ]);
    const numbers = await Promise.all(created.map(async (id) => (await diveOf(id)).diveNumber));
    expect(numbers.sort()).toEqual([1, 2]);
  });

  it('skips a row marked skip', async () => {
    const b = await batch('spreadsheet');
    const result = await repo.commit(scope, b, [sheetRow({ decision: 'skip' })]);
    expect(result.skipped).toBe(1);
    expect(result.created).toEqual([]);
  });

  it('refuses to merge onto a dive that is not this user’s', async () => {
    // A dive id from review is not a capability. Without this check a stale or
    // guessed id writes one person's import into another's logbook.
    const other = randomUUID();
    await prisma.user.create({ data: { id: other, email: `itest-${other}@mydivelog.invalid` } });
    const otherBatch = randomUUID();
    await prisma.importBatch.create({
      data: {
        id: otherBatch,
        userId: other,
        sourceKind: 'spreadsheet',
        originalFileKey: 'x',
        originalFileName: 'x',
        fileSize: 1,
        checksum: otherBatch,
      },
    });
    const theirs = await createImportRepository(prisma).commit(userScope(other), otherBatch, [
      sheetRow(),
    ]);

    const mine = await batch('uddf');
    const result = await repo.commit(scope, mine, [watchRow(theirs.created[0] as string)]);
    expect(result.merged).toEqual([]);
    expect(result.skipped).toBe(1);
  });
});

describe('commit is idempotent', () => {
  it('replaying a batch changes nothing', async () => {
    // What makes a retried request safe, and importing the same file twice a
    // no-op. The unique index on (importBatchId, sourceRef) is the mechanism.
    const sheet = await batch('spreadsheet');
    const { created } = await repo.commit(scope, sheet, [sheetRow()]);
    const diveId = created[0] as string;

    const watch = await batch('uddf');
    const first = await repo.commit(scope, watch, [watchRow(diveId)]);
    const before = await diveOf(diveId);
    const sourcesBefore = await prisma.diveSource.count({ where: { diveId } });

    const second = await repo.commit(scope, watch, [watchRow(diveId)]);

    expect(first.merged).toHaveLength(1);
    expect(second.merged).toHaveLength(0);
    expect(second.replayed).toBe(1);
    expect(await prisma.diveSource.count({ where: { diveId } })).toBe(sourcesBefore);
    expect(await diveOf(diveId)).toEqual(before);
  });
});

describe('revert', () => {
  it('restores a pre-existing dive to its exact prior state', async () => {
    // The acceptance criterion for the phase. Not "close to" — identical.
    const sheet = await batch('spreadsheet');
    const { created } = await repo.commit(scope, sheet, [sheetRow()]);
    const diveId = created[0] as string;

    const before = await diveOf(diveId);
    const provenanceBefore = await prisma.diveFieldProvenance.findMany({
      where: { diveId },
      orderBy: [{ fieldPath: 'asc' }, { sourceId: 'asc' }],
    });

    const watch = await batch('uddf');
    await repo.commit(scope, watch, [watchRow(diveId)]);
    // Confirm the import actually changed something, or the assertion below
    // would pass on a no-op.
    expect((await diveOf(diveId)).maxDepthM).not.toBeCloseTo(before.maxDepthM ?? 0, 6);

    await repo.revert(scope, watch);

    const after = await diveOf(diveId);
    expect(after.maxDepthM).toBeCloseTo(before.maxDepthM ?? 0, 9);
    expect(after.durationS).toBeNull();
    expect(after.waterTempMinC).toBeNull();
    expect(after.notes).toBe(before.notes);
    expect(after.visibilityM).toBe(before.visibilityM);
    expect(after.hasContestedFields).toBe(before.hasContestedFields);

    const provenanceAfter = await prisma.diveFieldProvenance.findMany({
      where: { diveId },
      orderBy: [{ fieldPath: 'asc' }, { sourceId: 'asc' }],
    });
    expect(provenanceAfter).toEqual(provenanceBefore);
  });

  it('restores every column, not only the ones a test thought to check', async () => {
    // The field-by-field assertion above is what caught the real bug: revert
    // was leaving `durationS` behind because resolution only ever *set*
    // columns and never cleared one whose last source had gone. This compares
    // the whole row so the next such field is caught without anyone naming it.
    const sheet = await batch('spreadsheet');
    const { created } = await repo.commit(scope, sheet, [sheetRow()]);
    const diveId = created[0] as string;

    // `updatedAt` and `version` legitimately move; everything else must not.
    const shape = (dive: Record<string, unknown>) => {
      const { updatedAt: _u, version: _v, ...rest } = dive;
      return rest;
    };

    const before = shape(await diveOf(diveId));
    const watch = await batch('uddf');
    await repo.commit(scope, watch, [watchRow(diveId)]);
    expect(shape(await diveOf(diveId))).not.toEqual(before);

    await repo.revert(scope, watch);
    expect(shape(await diveOf(diveId))).toEqual(before);
  });

  it('deletes a dive whose only source was the reverted batch', async () => {
    const b = await batch('spreadsheet');
    const { created } = await repo.commit(scope, b, [sheetRow()]);

    const result = await repo.revert(scope, b);
    expect(result.deleted).toEqual(created);
    expect(await prisma.dive.count({ where: { userId } })).toBe(0);
  });

  it('leaves dives the batch never touched alone', async () => {
    const first = await batch('spreadsheet');
    const { created: untouched } = await repo.commit(scope, first, [sheetRow()]);

    const second = await batch('spreadsheet');
    const { created: doomed } = await repo.commit(scope, second, [
      sheetRow({
        fields: { ...sheetRow().fields, startTimeUtc: new Date('2020-01-01T00:00:00Z') },
      }),
    ]);

    const before = await diveOf(untouched[0] as string);
    await repo.revert(scope, second);

    expect(await diveOf(untouched[0] as string)).toEqual(before);
    expect(await prisma.dive.findUnique({ where: { id: doomed[0] } })).toBeNull();
  });

  it('marks the batch reverted', async () => {
    const b = await batch('spreadsheet');
    await repo.commit(scope, b, [sheetRow()]);
    await repo.revert(scope, b);
    const record = await prisma.importBatch.findUniqueOrThrow({ where: { id: b } });
    expect(record.status).toBe('reverted');
    expect(record.revertedAt).not.toBeNull();
  });

  it('refuses to revert another user’s batch', async () => {
    const other = randomUUID();
    await prisma.user.create({ data: { id: other, email: `itest-${other}@mydivelog.invalid` } });
    const b = await batch('spreadsheet');
    await repo.commit(scope, b, [sheetRow()]);

    await expect(repo.revert(userScope(other), b)).rejects.toThrow(/does not belong/);
    expect(await prisma.dive.count({ where: { userId } })).toBe(1);
  });

  it('survives a commit, revert, commit cycle', async () => {
    // A diver who reverts and tries again must not accumulate anything.
    const sheet = await batch('spreadsheet');
    const { created } = await repo.commit(scope, sheet, [sheetRow()]);
    const diveId = created[0] as string;
    const before = await diveOf(diveId);

    for (let i = 0; i < 3; i++) {
      const watch = await batch('uddf');
      await repo.commit(scope, watch, [watchRow(diveId)]);
      await repo.revert(scope, watch);
    }

    const after = await diveOf(diveId);
    expect(after.maxDepthM).toBeCloseTo(before.maxDepthM ?? 0, 9);
    expect(await prisma.diveSource.count({ where: { diveId } })).toBe(1);
    expect(await prisma.diveFieldProvenance.count({ where: { diveId } })).toBe(7);
  });
});

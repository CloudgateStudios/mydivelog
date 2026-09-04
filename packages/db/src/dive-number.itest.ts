/**
 * Exercises the dive-number constraint against a real database. These are
 * integration tests: they need `pnpm services:up` and an applied migration,
 * and are excluded from the default unit run.
 *
 *   pnpm --filter @mydivelog/db test:integration
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renumberDives, renumberPlan } from '@mydivelog/domain';
import { createPrismaClient } from './client.ts';
import { createDiveRepository } from './repositories/dive.repository.ts';
import { userScope } from './scope.ts';

const prisma = createPrismaClient();
const repo = createDiveRepository(prisma);

const userId = randomUUID();
const scope = userScope(userId);

const makeDive = (n: number, day: number) => ({
  id: randomUUID(),
  diveNumber: n,
  startTimeUtc: new Date(Date.UTC(2026, 0, day, 10, 0, 0)),
  startTimeLocal: new Date(Date.UTC(2026, 0, day, 6, 0, 0)),
  tzOffsetMinutes: -240,
});

beforeAll(async () => {
  await prisma.user.create({
    data: { id: userId, email: `itest-${userId}@mydivelog.invalid` },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('dive numbers against a real database', () => {
  it('assigns the next number when none is supplied', async () => {
    const a = await repo.create(scope, {
      id: randomUUID(),
      startTimeUtc: new Date('2026-01-01T10:00:00Z'),
      startTimeLocal: new Date('2026-01-01T06:00:00Z'),
      tzOffsetMinutes: -240,
    });
    const b = await repo.create(scope, {
      id: randomUUID(),
      startTimeUtc: new Date('2026-01-02T10:00:00Z'),
      startTimeLocal: new Date('2026-01-02T06:00:00Z'),
      tzOffsetMinutes: -240,
    });
    expect(a.diveNumber).toBe(1);
    expect(b.diveNumber).toBe(2);
  });

  it('rejects a duplicate number for the same diver', async () => {
    await expect(prisma.dive.create({ data: { ...makeDive(1, 5), userId } })).rejects.toThrow(
      /[Uu]nique/,
    );
  });

  it('lets a different diver reuse the same number', async () => {
    const otherId = randomUUID();
    await prisma.user.create({
      data: { id: otherId, email: `itest-${otherId}@mydivelog.invalid` },
    });
    const created = await prisma.dive.create({
      data: { ...makeDive(1, 5), userId: otherId },
    });
    expect(created.diveNumber).toBe(1);
    await prisma.user.delete({ where: { id: otherId } });
  });

  it('frees a number once the dive is soft-deleted', async () => {
    // The reason the index is partial. A plain unique constraint would let the
    // tombstone squat number 3 forever.
    const doomed = await repo.create(scope, { ...makeDive(3, 9) });
    expect(await repo.softDelete(scope, doomed.id)).toBe(true);

    const replacement = await repo.create(scope, { ...makeDive(3, 10) });
    expect(replacement.diveNumber).toBe(3);
  });

  it('renumbers without colliding with itself', async () => {
    // A naive `diveNumber + 1` fails here: the index is partial and therefore
    // cannot be deferred, so uniqueness is checked row by row.
    const before = await repo.list(scope, { limit: 100 });
    const live = before.filter((d) => d.deletedAt === null);

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE dives SET "diveNumber" = "diveNumber" + 1 WHERE "userId" = $1 AND "deletedAt" IS NULL`,
        userId,
      ),
    ).rejects.toThrow();

    // The two-phase plan succeeds where the naive shift fails.
    const changes = renumberDives(
      live.map((d) => ({ id: d.id, startTimeUtc: d.startTimeUtc, diveNumber: d.diveNumber })),
      10,
    );
    const updated = await repo.applyRenumbering(scope, renumberPlan(changes));
    expect(updated).toBe(changes.length);

    const after = await repo.list(scope, { limit: 100 });
    const numbers = after.map((d) => d.diveNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([...numbers].map((_, i) => 10 + i));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

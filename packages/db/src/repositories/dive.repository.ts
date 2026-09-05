import type { Prisma, PrismaClient } from '../generated/client.ts';
import type { UserScope } from '../scope.ts';

export type DiveListFilters = {
  from?: Date;
  to?: Date;
  siteId?: string;
  tripId?: string;
  hasProfile?: boolean;
  minDepthM?: number;
  maxDepthM?: number;
  limit?: number;
  cursor?: string;
};

/**
 * Every method takes a UserScope first and applies it itself. No method exposes
 * a `where` that a caller could supply unscoped, which is what makes ownership
 * a property of this layer rather than a rule people follow.
 */
export function createDiveRepository(prisma: PrismaClient) {
  /** The scope clause every query starts from. Soft-deleted rows are excluded. */
  const owned = (scope: UserScope): Prisma.DiveWhereInput => ({
    userId: scope.userId,
    deletedAt: null,
  });

  return {
    async list(scope: UserScope, filters: DiveListFilters = {}) {
      const where: Prisma.DiveWhereInput = { ...owned(scope) };

      if (filters.from || filters.to) {
        where.startTimeUtc = {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        };
      }
      if (filters.siteId) where.siteId = filters.siteId;
      if (filters.tripId) where.tripId = filters.tripId;
      if (filters.hasProfile !== undefined) where.hasProfile = filters.hasProfile;
      if (filters.minDepthM !== undefined || filters.maxDepthM !== undefined) {
        where.maxDepthM = {
          ...(filters.minDepthM !== undefined ? { gte: filters.minDepthM } : {}),
          ...(filters.maxDepthM !== undefined ? { lte: filters.maxDepthM } : {}),
        };
      }

      const take = Math.min(filters.limit ?? 50, 200);
      return prisma.dive.findMany({
        where,
        orderBy: { startTimeUtc: 'desc' },
        take: take + 1, // one extra row tells the caller whether more exist
        ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      });
    },

    /** Returns null rather than throwing, so callers answer 404 not 403. */
    async findById(scope: UserScope, id: string) {
      return prisma.dive.findFirst({ where: { ...owned(scope), id } });
    },

    /**
     * A dive with everything a detail view needs, in one query.
     *
     * Provenance comes along because "where did this value come from" is the
     * question this product exists to answer, and a second round trip to
     * answer it makes it feel like a footnote rather than the point.
     *
     * The profile's samples are deliberately not here — they live in object
     * storage and are fetched separately, so a dive that has one still loads
     * at the speed of a dive that does not.
     */
    async findDetailById(scope: UserScope, id: string) {
      return prisma.dive.findFirst({
        where: { ...owned(scope), id },
        include: {
          site: true,
          profile: true,
          tags: { include: { tag: true } },
          buddies: { include: { buddy: true } },
          sources: { orderBy: { recordedAt: 'asc' } },
          provenance: true,
        },
      });
    },

    /**
     * `diveNumber` is required, and most sources do not supply one — the sample
     * UDDF carries none across 96 dives — so it defaults to the next free
     * number for this diver.
     */
    async create(
      scope: UserScope,
      data: Omit<Prisma.DiveUncheckedCreateInput, 'userId' | 'diveNumber'> & {
        diveNumber?: number;
      },
    ) {
      const diveNumber = data.diveNumber ?? (await this.nextDiveNumber(scope));
      return prisma.dive.create({ data: { ...data, diveNumber, userId: scope.userId } });
    },

    /** One past the highest live number, or 1 for a diver's first dive. */
    async nextDiveNumber(scope: UserScope): Promise<number> {
      const max = await this.maxDiveNumber(scope);
      return (max ?? 0) + 1;
    },

    /**
     * Applies a renumbering produced by `renumberDives` from @mydivelog/domain.
     *
     * Two passes, in one transaction. The uniqueness index is partial — it
     * excludes soft-deleted rows so a tombstone does not squat its number — and
     * Postgres cannot defer a partial index, so a single shift collides with
     * itself row by row. Parking in the negatives first avoids that; live
     * numbers are always positive.
     */
    async applyRenumbering(
      scope: UserScope,
      plan: {
        park: readonly { id: string; diveNumber: number }[];
        land: readonly { id: string; diveNumber: number }[];
      },
    ): Promise<number> {
      if (plan.land.length === 0) return 0;

      return prisma.$transaction(async (tx) => {
        for (const { id, diveNumber } of plan.park) {
          await tx.dive.updateMany({ where: { ...owned(scope), id }, data: { diveNumber } });
        }
        let updated = 0;
        for (const { id, diveNumber } of plan.land) {
          const r = await tx.dive.updateMany({
            where: { userId: scope.userId, id },
            data: { diveNumber, version: { increment: 1 } },
          });
          updated += r.count;
        }
        return updated;
      });
    },

    async update(
      scope: UserScope,
      id: string,
      data: Omit<Prisma.DiveUncheckedUpdateInput, 'userId' | 'id'>,
    ) {
      // updateMany rather than update: it applies the scope in the WHERE clause,
      // so another user's row cannot be touched even by id.
      const result = await prisma.dive.updateMany({
        where: { ...owned(scope), id },
        data: { ...data, version: { increment: 1 } },
      });
      return result.count === 1 ? this.findById(scope, id) : null;
    },

    /** Soft delete. Offline clients need the tombstone to learn about it. */
    async softDelete(scope: UserScope, id: string) {
      const result = await prisma.dive.updateMany({
        where: { ...owned(scope), id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      return result.count === 1;
    },

    async restore(scope: UserScope, id: string) {
      const result = await prisma.dive.updateMany({
        where: { userId: scope.userId, id, deletedAt: { not: null } },
        data: { deletedAt: null, version: { increment: 1 } },
      });
      return result.count === 1;
    },

    async count(scope: UserScope) {
      return prisma.dive.count({ where: owned(scope) });
    },

    /** Highest live dive number in use. */
    async maxDiveNumber(scope: UserScope): Promise<number | null> {
      const row = await prisma.dive.aggregate({
        where: owned(scope),
        _max: { diveNumber: true },
      });
      return row._max.diveNumber ?? null;
    },
  };
}

export type DiveRepository = ReturnType<typeof createDiveRepository>;

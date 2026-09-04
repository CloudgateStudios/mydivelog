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

    async create(scope: UserScope, data: Omit<Prisma.DiveUncheckedCreateInput, 'userId'>) {
      return prisma.dive.create({ data: { ...data, userId: scope.userId } });
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

    /** Highest dive number in use, for suggesting the next one. */
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

import type { Prisma, PrismaClient } from '../generated/client.ts';
import type { UserScope } from '../scope.ts';

export type TripInput = {
  name: string;
  startDate?: Date | null;
  endDate?: Date | null;
  operator?: string | null;
  notes?: string | null;
};

/**
 * Trips, scoped to their owner like every other repository here.
 *
 * Assigning dives is the operation that matters: a trip with no dives in it is
 * a name, and the point of the page is to answer "what did I do that week".
 */
export function createTripRepository(prisma: PrismaClient) {
  const owned = (scope: UserScope) => ({ userId: scope.userId, deletedAt: null });

  const summary = {
    id: true,
    name: true,
    startDate: true,
    endDate: true,
    operator: true,
    notes: true,
    createdAt: true,
  } satisfies Prisma.TripSelect;

  return {
    async list(scope: UserScope) {
      const trips = await prisma.trip.findMany({
        where: owned(scope),
        select: { ...summary, _count: { select: { dives: true } } },
        // Undated trips last rather than first: a trip somebody has not dated
        // yet is the one they are still filling in.
        orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      });
      return trips.map(({ _count, ...trip }) => ({ ...trip, dives: _count.dives }));
    },

    /** Returns null rather than throwing, so callers answer 404 not 403. */
    async find(scope: UserScope, id: string) {
      const trip = await prisma.trip.findFirst({ where: { ...owned(scope), id }, select: summary });
      if (!trip) return null;

      const dives = await prisma.dive.findMany({
        where: { userId: scope.userId, deletedAt: null, tripId: id },
        select: {
          id: true,
          diveNumber: true,
          startTimeLocal: true,
          maxDepthM: true,
          durationS: true,
          site: { select: { id: true, name: true } },
        },
        orderBy: { startTimeUtc: 'asc' },
      });
      return { trip, dives };
    },

    async create(scope: UserScope, id: string, input: TripInput) {
      return prisma.trip.create({
        data: {
          id,
          userId: scope.userId,
          name: input.name,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          operator: input.operator ?? null,
          notes: input.notes ?? null,
        },
        select: summary,
      });
    },

    async update(scope: UserScope, id: string, input: Partial<TripInput>) {
      const { count } = await prisma.trip.updateMany({
        where: { ...owned(scope), id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
          ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
          ...(input.operator === undefined ? {} : { operator: input.operator }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
        },
      });
      if (count === 0) return null;
      return prisma.trip.findFirst({ where: { ...owned(scope), id }, select: summary });
    },

    /**
     * Soft delete, and the dives are released rather than removed.
     *
     * Deleting a trip must never look like deleting the diving. The dives go
     * back to belonging to no trip, which is where they were before.
     */
    async remove(scope: UserScope, id: string) {
      const { count } = await prisma.trip.updateMany({
        where: { ...owned(scope), id },
        data: { deletedAt: new Date() },
      });
      if (count === 0) return false;

      await prisma.dive.updateMany({
        where: { userId: scope.userId, tripId: id },
        data: { tripId: null },
      });
      return true;
    },

    /**
     * Puts dives in a trip, or takes them out.
     *
     * Scoped on both sides: the trip must be this diver's and so must every
     * dive, so a crafted request cannot pull somebody else's dive into a trip
     * or push one out of theirs.
     */
    async setDives(scope: UserScope, tripId: string | null, diveIds: readonly string[]) {
      if (tripId !== null) {
        const trip = await prisma.trip.findFirst({ where: { ...owned(scope), id: tripId } });
        if (!trip) return null;
      }
      const { count } = await prisma.dive.updateMany({
        where: { userId: scope.userId, deletedAt: null, id: { in: [...diveIds] } },
        data: { tripId },
      });
      return count;
    },

    /** Dives not yet in any trip, for the "add dives" picker. */
    async unassigned(scope: UserScope, limit = 200) {
      return prisma.dive.findMany({
        where: { userId: scope.userId, deletedAt: null, tripId: null },
        select: {
          id: true,
          diveNumber: true,
          startTimeLocal: true,
          // The region as well as the site: a trip is a place, so "Bonaire,
          // March 2026" beats "1,000 Steps, March 2026". The site is the
          // fallback, because plenty of imports record no region at all.
          site: { select: { name: true, region: { select: { name: true } } } },
          siteId: true,
        },
        orderBy: { startTimeUtc: 'desc' },
        take: limit,
      });
    },
  };
}

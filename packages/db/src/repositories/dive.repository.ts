import type { Prisma, PrismaClient } from '../generated/client.ts';
import type { UserScope } from '../scope.ts';

/**
 * How a filtered log is ordered.
 *
 * Every one of these is completed with `id` as a tiebreaker below, which is
 * what makes cursor pagination correct: Prisma's cursor walks a sequence, and
 * a sort with ties has no single sequence to walk. Two dives on the same day
 * — a morning and an afternoon dive with the same recorded start, which the
 * spreadsheet produces often — would otherwise be able to swap places between
 * page one and page two, showing one twice and the other never.
 */
export type DiveSort = 'date_desc' | 'date_asc' | 'depth_desc' | 'duration_desc' | 'number_asc';

export type DiveListFilters = {
  from?: Date;
  to?: Date;
  siteId?: string;
  tripId?: string;
  hasProfile?: boolean;
  minDepthM?: number;
  maxDepthM?: number;
  /** Tag slugs, all of which must be present. See `where` below. */
  tagSlugs?: string[];
  /** Free text over site name, notes and buddy names. */
  q?: string;
  sort?: DiveSort;
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

  /**
   * A date filter reads the *local* start time, not UTC.
   *
   * "Dives in March" means the dives the diver did in March where they were,
   * and a 7am dive in Bonaire is the 6th in UTC and the 5th on the boat. The
   * column is `timestamp without time zone` holding wall clock, so comparing
   * it to a wall-clock bound is comparing like with like.
   */
  const whereFor = (scope: UserScope, filters: DiveListFilters): Prisma.DiveWhereInput => {
    const where: Prisma.DiveWhereInput = { ...owned(scope) };

    if (filters.from || filters.to) {
      where.startTimeLocal = {
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

    // Every tag must be present, which needs one `some` per slug: a single
    // `some: { tag: { slug: { in: [...] } } }` is "any of", and a diver who
    // picks `wreck` and `night` is narrowing, not widening.
    if (filters.tagSlugs?.length) {
      where.AND = filters.tagSlugs.map((slug) => ({ tags: { some: { tag: { slug } } } }));
    }

    // Free text over the fields a diver would recognise a dive by. Deliberately
    // not `privateNotes`: it is shown on no screen and included in no export, so
    // a dive matched only there arrives with nothing on it that explains why.
    if (filters.q?.trim()) {
      const contains = { contains: filters.q.trim(), mode: 'insensitive' as const };
      where.OR = [
        { notes: contains },
        { site: { name: contains } },
        { buddies: { some: { buddy: { displayName: contains } } } },
      ];
    }

    return where;
  };

  /**
   * A total order. See DiveSort.
   *
   * Ordering is by UTC while *filtering* is by local time, and the split is
   * deliberate. "March" is a local question — a 7am dive in Bonaire is the 5th
   * on the boat and the 6th in UTC. But "which dive came first" is not: sorting
   * a logbook by wall clock puts an 8am dive in Fiji before a 9pm dive in
   * Bonaire that actually happened two days earlier, and dive 24 lands above
   * dive 23.
   */
  const orderFor = (sort: DiveSort = 'date_desc'): Prisma.DiveOrderByWithRelationInput[] => {
    const tiebreak = { id: 'asc' } as const;
    switch (sort) {
      case 'date_asc':
        return [{ startTimeUtc: 'asc' }, tiebreak];
      // Nulls last on both: a dive with no recorded depth is not the deepest,
      // and Postgres sorts NULL first on DESC by default.
      case 'depth_desc':
        return [{ maxDepthM: { sort: 'desc', nulls: 'last' } }, tiebreak];
      case 'duration_desc':
        return [{ durationS: { sort: 'desc', nulls: 'last' } }, tiebreak];
      case 'number_asc':
        return [{ diveNumber: 'asc' }, tiebreak];
      default:
        return [{ startTimeUtc: 'desc' }, tiebreak];
    }
  };

  return {
    async list(scope: UserScope, filters: DiveListFilters = {}) {
      const take = Math.min(filters.limit ?? 50, 200);
      return prisma.dive.findMany({
        where: whereFor(scope, filters),
        orderBy: orderFor(filters.sort),
        take: take + 1, // one extra row tells the caller whether more exist
        ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
        // The name, not just the id. A log that says where each dive was is
        // the difference between a list of numbers and a logbook, and the
        // alternative is every caller resolving ids against the facets.
        include: { site: { select: { name: true } } },
      });
    },

    /**
     * How many dives match, ignoring pagination.
     *
     * Separate from `list` and asked for explicitly, because it is a second
     * query and most callers do not need it. A filter UI does: "no dives" and
     * "no dives on this page" look identical without it, and the difference is
     * whether the diver should widen the filter or press next.
     */
    async count(scope: UserScope, filters: DiveListFilters = {}) {
      return prisma.dive.count({ where: whereFor(scope, filters) });
    },

    /**
     * What this diver can actually filter by, with counts.
     *
     * Only sites and tags that appear on at least one of their dives. A
     * dropdown offering every site in the reference data is a list of ways to
     * get an empty page, and the counts turn choosing a filter into reading
     * the shape of a logbook.
     */
    async facets(scope: UserScope) {
      const [sites, tags, bounds] = await Promise.all([
        prisma.dive.groupBy({
          by: ['siteId'],
          where: { ...owned(scope), siteId: { not: null } },
          _count: { _all: true },
        }),
        prisma.diveTag.groupBy({
          by: ['tagId'],
          where: { dive: owned(scope) },
          _count: { _all: true },
        }),
        prisma.dive.aggregate({
          where: owned(scope),
          _min: { startTimeLocal: true, maxDepthM: true },
          _max: { startTimeLocal: true, maxDepthM: true },
        }),
      ]);

      const [siteRows, tagRows] = await Promise.all([
        prisma.site.findMany({
          where: { id: { in: sites.map((s) => s.siteId as string) } },
          select: { id: true, name: true },
        }),
        prisma.tag.findMany({
          where: { id: { in: tags.map((t) => t.tagId) } },
          select: { id: true, slug: true, label: true },
        }),
      ]);

      const byCountThenName = <T extends { count: number; name: string }>(a: T, b: T) =>
        b.count - a.count || a.name.localeCompare(b.name);

      return {
        sites: siteRows
          .map((site) => ({
            id: site.id,
            name: site.name,
            count: sites.find((s) => s.siteId === site.id)?._count._all ?? 0,
          }))
          .sort(byCountThenName),
        tags: tagRows
          .map((tag) => ({
            slug: tag.slug,
            name: tag.label,
            count: tags.find((t) => t.tagId === tag.id)?._count._all ?? 0,
          }))
          .sort(byCountThenName),
        depthM: { min: bounds._min.maxDepthM, max: bounds._max.maxDepthM },
        dates: { first: bounds._min.startTimeLocal, last: bounds._max.startTimeLocal },
      };
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

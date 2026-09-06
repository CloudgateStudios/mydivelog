import type { PrismaClient } from '../generated/client.ts';
import type { UserScope } from '../scope.ts';

/**
 * Sites, as this diver's own logbook knows them.
 *
 * The Site table is shared — imported sites start private, and a moderation
 * path promotes well-attested ones — so "my sites" is not a column on Site. It
 * is the set of sites this diver has actually dived, which is why every query
 * here starts from their dives rather than from the site table.
 *
 * That also means a site nobody has dived cannot appear, which is the correct
 * behaviour for a page whose whole subject is where you have been.
 */
export function createSiteRepository(prisma: PrismaClient) {
  const ownedDives = (scope: UserScope) => ({ userId: scope.userId, deletedAt: null });

  return {
    async listForDiver(scope: UserScope) {
      const grouped = await prisma.dive.groupBy({
        by: ['siteId'],
        where: { ...ownedDives(scope), siteId: { not: null } },
        _count: { _all: true },
        _max: { maxDepthM: true, startTimeLocal: true },
        _min: { startTimeLocal: true },
      });

      const sites = await prisma.site.findMany({
        where: { id: { in: grouped.map((g) => g.siteId as string) } },
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
          region: { select: { name: true } },
        },
      });

      const byId = new Map(grouped.map((g) => [g.siteId as string, g]));
      return sites
        .map((site) => {
          const stats = byId.get(site.id);
          return {
            id: site.id,
            name: site.name,
            latitude: site.latitude,
            longitude: site.longitude,
            regionName: site.region?.name ?? null,
            dives: stats?._count._all ?? 0,
            maxDepthM: stats?._max.maxDepthM ?? null,
            firstDive: stats?._min.startTimeLocal ?? null,
            lastDive: stats?._max.startTimeLocal ?? null,
          };
        })
        .sort((a, b) => b.dives - a.dives || a.name.localeCompare(b.name));
    },

    /**
     * One site, but only if this diver has dived it.
     *
     * Returns null otherwise so the caller answers 404 — a site record they
     * have no dives at is, from their logbook's point of view, not a site of
     * theirs, and confirming it exists would leak the shared table's contents.
     */
    async findForDiver(scope: UserScope, siteId: string) {
      const dives = await prisma.dive.findMany({
        where: { ...ownedDives(scope), siteId },
        select: {
          id: true,
          diveNumber: true,
          startTimeLocal: true,
          maxDepthM: true,
          durationS: true,
          waterTempMinC: true,
          hasProfile: true,
        },
        orderBy: { startTimeUtc: 'desc' },
      });
      if (dives.length === 0) return null;

      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
          maxDepthM: true,
          typicalEntry: true,
          description: true,
          region: { select: { name: true } },
          aliases: { select: { name: true } },
        },
      });
      if (!site) return null;

      return {
        site: {
          id: site.id,
          name: site.name,
          latitude: site.latitude,
          longitude: site.longitude,
          regionName: site.region?.name ?? null,
          typicalEntry: site.typicalEntry,
          description: site.description,
          // The names other sources called it. "1,000 Steps" and "Thousand
          // Steps" are the same place, and seeing both is how a diver knows
          // the merge did the right thing.
          aliases: site.aliases.map((a) => a.name).filter((name) => name !== site.name),
        },
        dives,
      };
    },
  };
}

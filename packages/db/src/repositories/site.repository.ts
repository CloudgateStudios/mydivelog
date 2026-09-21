import { randomUUID } from 'node:crypto';
import { slugify } from '@mydivelog/domain';
import type { Prisma, PrismaClient } from '../generated/client.ts';
import type { UserScope } from '../scope.ts';
import { UNNAMED_SITE } from './import.repository.ts';

/** What a diver may change; a `Pick` so the columns stay right as the schema moves. */
export type SiteEdit = Pick<
  Prisma.SiteUncheckedUpdateInput,
  'name' | 'latitude' | 'longitude' | 'typicalEntry' | 'description'
>;

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
     * Correcting a site of one's own.
     *
     * Scoped to the owner in the WHERE clause rather than checked first, so
     * another diver's site cannot be touched even by id. `isPublic: false` is
     * part of that scope: once a site is in the shared database its name is
     * everyone's, and changing it is a suggestion for staff rather than an
     * edit — the caller tells the diver so.
     *
     * Returns null when nothing matched, which the caller turns into the right
     * refusal by asking why.
     */
    async updateOwn(scope: UserScope, siteId: string, data: SiteEdit) {
      const owned = { id: siteId, ownerUserId: scope.userId, deletedAt: null, isPublic: false };
      const before = await prisma.site.findFirst({ where: owned });
      if (!before) return null;

      const renaming = typeof data.name === 'string' && slugify(data.name) !== slugify(before.name);

      const site = await prisma.site.update({ where: { id: siteId }, data });

      /*
       * The old name is kept as an alias, so a future import of a file that
       * still uses it matches this site instead of creating a second one.
       *
       * Except the placeholder. `Unnamed site` as an alias would match every
       * coordinates-only site a dive computer ever produces, quietly folding
       * unrelated places into this one — the opposite of what an alias is for.
       */
      if (renaming && before.name !== UNNAMED_SITE) {
        await prisma.siteAlias.upsert({
          where: { siteId_name: { siteId, name: before.name } },
          create: { id: randomUUID(), siteId, name: before.name, source: 'user' },
          update: {},
        });
      }

      // A name the diver has now chosen is no longer merely "also recorded
      // as": leaving it would show the site as an alias of itself.
      if (renaming) {
        await prisma.siteAlias.deleteMany({ where: { siteId, name: site.name } });
      }

      return site;
    },

    /** Why an update matched nothing, so the caller can say which it was. */
    async whyNotEditable(scope: UserScope, siteId: string) {
      const site = await prisma.site.findFirst({ where: { id: siteId, deletedAt: null } });
      if (!site) return 'missing' as const;
      if (site.isPublic) return 'shared' as const;
      if (site.ownerUserId !== scope.userId) return 'not-yours' as const;
      return 'unknown' as const;
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
          isPublic: true,
          ownerUserId: true,
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
          /*
           * Whether this diver may correct it, answered here rather than left
           * for the page to infer.
           *
           * The alternative is shipping `ownerUserId` and `isPublic` and
           * having each caller redo the rule — which means one of them
           * eventually gets it wrong, and also hands one diver another's user
           * id for no reason.
           */
          editable: site.isPublic === false && site.ownerUserId === scope.userId,
          /** Why not, when not — so the page can say something useful. */
          shared: site.isPublic,
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

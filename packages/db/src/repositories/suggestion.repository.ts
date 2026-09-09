import { randomUUID } from 'node:crypto';
import { slugify } from '@mydivelog/domain';
import type { PrismaClient } from '../generated/client.ts';
import type { StaffScope, UserScope } from '../scope.ts';
import { UNNAMED_SITE } from './import.repository.ts';

/**
 * Proposals for what a shared site should be called.
 *
 * A site nobody else can see is the diver's own record and they edit it
 * directly. Once a site is promoted into the shared database its name belongs
 * to everyone who dives there, so changing it becomes a request — made by a
 * diver, decided by staff. Promotion itself is staff-initiated and is not
 * requested through here.
 *
 * Every decision writes its audit row in the same transaction as the change,
 * the same way every other staff action does. See admin.repository.ts: the
 * point is that an unaudited decision would have to be a new code path rather
 * than a forgotten line.
 */

export type SuggestionOutcome = 'approved' | 'rejected';

export class SuggestionRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SuggestionRefusal';
  }
}

export function createSuggestionRepository(prisma: PrismaClient) {
  return {
    /**
     * A diver proposes a name for a site they have dived.
     *
     * Dived, not merely found: a suggestion from somebody who has never been
     * there is not evidence about the place, and requiring it costs nothing
     * because the sites page only lists sites they have dived anyway.
     */
    async suggest(scope: UserScope, siteId: string, proposed: string, reason: string | undefined) {
      const site = await prisma.site.findFirst({ where: { id: siteId, deletedAt: null } });
      if (!site) return null;

      if (!site.isPublic) {
        throw new SuggestionRefusal(
          'site_not_shared',
          'This site is yours alone, so there is nobody to ask — edit it directly.',
        );
      }

      const dived = await prisma.dive.count({
        where: { userId: scope.userId, siteId, deletedAt: null },
      });
      if (dived === 0) {
        throw new SuggestionRefusal(
          'not_your_site',
          'Only divers who have logged a dive here can suggest what it is called.',
        );
      }

      if (slugify(proposed) === slugify(site.name)) {
        throw new SuggestionRefusal(
          'already_named_that',
          `This site is already called "${site.name}".`,
        );
      }

      // One open suggestion per diver per site. Without it the queue fills
      // with one person changing their mind, and staff read the same site
      // five times.
      const open = await prisma.siteNameSuggestion.findFirst({
        where: { siteId, userId: scope.userId, status: 'pending' },
      });
      if (open) {
        throw new SuggestionRefusal(
          'already_suggested',
          `You have already suggested "${open.proposed}" for this site. ` +
            'A moderator will look at it.',
        );
      }

      return prisma.siteNameSuggestion.create({
        data: {
          id: randomUUID(),
          siteId,
          userId: scope.userId,
          proposed,
          ...(reason === undefined ? {} : { reason }),
        },
      });
    },

    /** What this diver has proposed for this site, so the page can say. */
    async mineFor(scope: UserScope, siteId: string) {
      return prisma.siteNameSuggestion.findMany({
        where: { siteId, userId: scope.userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
    },

    /** The queue: oldest first, because a suggestion waiting longest waits worst. */
    async pending(limit = 100) {
      const rows = await prisma.siteNameSuggestion.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: limit,
        include: {
          site: { select: { id: true, name: true, latitude: true, longitude: true } },
          user: { select: { id: true, email: true } },
        },
      });

      // How many dives the suggester has logged there, which is the single
      // most useful thing a moderator can know: somebody with forty dives at
      // a site knows what it is called.
      const counts = await prisma.dive.groupBy({
        by: ['siteId', 'userId'],
        where: {
          deletedAt: null,
          OR: rows.map((row) => ({ siteId: row.siteId, userId: row.userId })),
        },
        _count: { _all: true },
      });
      const key = (siteId: string, userId: string) => `${siteId}:${userId}`;
      const dives = new Map(counts.map((c) => [key(c.siteId as string, c.userId), c._count._all]));

      return rows.map((row) => ({
        ...row,
        diverDives: dives.get(key(row.siteId, row.userId)) ?? 0,
      }));
    },

    /**
     * Approve or reject, and record the decision where the diver can read it.
     *
     * One transaction: the site's new name, the decision, and the audit row
     * land together or not at all. A rename that happened without a decision
     * beside it would be a name nobody could account for.
     */
    async decide(
      scope: StaffScope,
      suggestionId: string,
      outcome: SuggestionOutcome,
      note: string | undefined,
      writeAudit: (
        tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
        scope: StaffScope,
        event: {
          action: string;
          entityType: string;
          entityId?: string;
          metadata?: Record<string, unknown>;
        },
      ) => Promise<void>,
    ) {
      return prisma.$transaction(async (tx) => {
        const suggestion = await tx.siteNameSuggestion.findUnique({
          where: { id: suggestionId },
          include: {
            site: { select: { id: true, name: true } },
            user: { select: { id: true, email: true } },
          },
        });
        if (!suggestion) return null;
        if (suggestion.status !== 'pending') {
          throw new SuggestionRefusal(
            'already_decided',
            `This suggestion was already ${suggestion.status}.`,
          );
        }

        const previousName = suggestion.site.name;

        if (outcome === 'approved') {
          await tx.site.update({
            where: { id: suggestion.siteId },
            data: { name: suggestion.proposed },
          });

          // The old name stays findable, so an import of a file that still
          // uses it matches this site rather than creating another. Not the
          // placeholder: `Unnamed site` as an alias would match every
          // coordinates-only site a dive computer ever produces.
          if (previousName !== UNNAMED_SITE) {
            await tx.siteAlias.upsert({
              where: { siteId_name: { siteId: suggestion.siteId, name: previousName } },
              create: {
                id: randomUUID(),
                siteId: suggestion.siteId,
                name: previousName,
                source: 'staff',
              },
              update: {},
            });
          }
          await tx.siteAlias.deleteMany({
            where: { siteId: suggestion.siteId, name: suggestion.proposed },
          });

          // Everyone else still waiting on this site is now proposing against
          // a name that has moved. Left pending they would be decided against
          // the wrong thing.
          await tx.siteNameSuggestion.updateMany({
            where: { siteId: suggestion.siteId, status: 'pending', NOT: { id: suggestionId } },
            data: {
              status: 'rejected',
              decidedById: scope.staffUserId,
              decidedAt: new Date(),
              decisionNote: `The site was renamed to "${suggestion.proposed}" instead.`,
            },
          });
        }

        await tx.siteNameSuggestion.update({
          where: { id: suggestionId },
          data: {
            status: outcome,
            decidedById: scope.staffUserId,
            decidedAt: new Date(),
            ...(note === undefined ? {} : { decisionNote: note }),
          },
        });

        await writeAudit(tx, scope, {
          action: `site.name.${outcome}`,
          entityType: 'site',
          entityId: suggestion.siteId,
          metadata: {
            suggestionId,
            proposed: suggestion.proposed,
            previousName,
            suggestedBy: suggestion.user.email,
            ...(note === undefined ? {} : { note }),
          },
        });

        return {
          outcome,
          siteId: suggestion.siteId,
          proposed: suggestion.proposed,
          previousName,
          diverEmail: suggestion.user.email,
          ...(note === undefined ? {} : { note }),
        };
      });
    },
  };
}

export type SuggestionRepository = ReturnType<typeof createSuggestionRepository>;

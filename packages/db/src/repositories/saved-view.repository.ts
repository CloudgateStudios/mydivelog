import type { PrismaClient } from '../generated/client.ts';
import type { UserScope } from '../scope.ts';

export type SavedViewInput = {
  name: string;
  query: string;
};

/**
 * Named filter sets, scoped to their owner like every other repository here.
 *
 * `query` is stored as an opaque string; validating what is in it is the
 * caller's job, because the schema that defines a valid filter lives in
 * contracts and this package must not depend on it. See the SavedView model.
 */
export function createSavedViewRepository(prisma: PrismaClient) {
  const owned = (scope: UserScope) => ({ userId: scope.userId });

  return {
    async list(scope: UserScope) {
      return prisma.savedView.findMany({
        where: owned(scope),
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
    },

    async find(scope: UserScope, id: string) {
      return prisma.savedView.findFirst({ where: { ...owned(scope), id } });
    },

    /**
     * Saving twice under one name updates rather than failing.
     *
     * A diver who adjusts a filter and saves it under the name they already
     * used means "this is what that view is now". Refusing with a uniqueness
     * error would be technically correct and useless — they cannot see the
     * constraint, only that their button did nothing.
     */
    async upsert(scope: UserScope, id: string, input: SavedViewInput) {
      const last = await prisma.savedView.findFirst({
        where: owned(scope),
        orderBy: { position: 'desc' },
        select: { position: true },
      });

      return prisma.savedView.upsert({
        where: { userId_name: { userId: scope.userId, name: input.name } },
        create: {
          id,
          userId: scope.userId,
          name: input.name,
          query: input.query,
          position: (last?.position ?? -1) + 1,
        },
        update: { query: input.query },
      });
    },

    /** Returns false rather than throwing, so callers answer 404 not 403. */
    async remove(scope: UserScope, id: string) {
      const { count } = await prisma.savedView.deleteMany({ where: { ...owned(scope), id } });
      return count > 0;
    },
  };
}

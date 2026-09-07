import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/client.ts';
import type { StaffScope } from '../scope.ts';

/**
 * Staff mutations.
 *
 * `docs/11-roadmap.md` makes "every staff action appears in the audit log" an
 * acceptance criterion. A convention cannot deliver that — someone eventually
 * writes the update and forgets the log, and nothing notices for a year. So the
 * audit row is not written *alongside* the change here; it is written *by the
 * same transaction*, in `change()`, and there is no other way into this file.
 * An unaudited staff mutation would have to be a new code path, not a
 * forgotten line.
 *
 * Everything here crosses users by design, which is why every method takes a
 * `StaffScope` rather than a `UserScope`. A `StaffScope` cannot be constructed
 * without a reason, so "why" is carried by the type system rather than by
 * whoever remembers to pass it.
 */

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** What a mutation records about itself. */
type Event = {
  /** Dotted and past-tense-free: `site.merge`, `user.delete`. Grepped, filtered on. */
  action: string;
  entityType: string;
  entityId?: string;
  /** Anything a person reading the log in six months would want. */
  metadata?: Record<string, unknown>;
};

/**
 * Refused because the change would silently destroy something.
 *
 * Distinct from "not found" so the API can answer 409 and say what to do
 * instead, which for a site in use is "merge it".
 */
export class StaffRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StaffRefusal';
  }
}

export function createAdminRepository(prisma: PrismaClient) {
  /**
   * One staff change, and the record of it, in one transaction.
   *
   * `fn` returns `null` to mean "nothing matched" — a 404 rather than a
   * change. Nothing is written in that case, including the audit row: an
   * action that changed nothing is a mistyped id, and a log full of those is a
   * log nobody reads. Attempts are deliberately not recorded; if that turns out
   * to matter, it is a separate decision with its own retention question.
   */
  async function change<T>(
    scope: StaffScope,
    event: Event,
    fn: (tx: Tx) => Promise<T | null>,
    /**
     * Extra metadata drawn from what actually happened — the diff, the number
     * of dives moved. Runs after `fn`, inside the same transaction, so the log
     * describes the change rather than the request.
     */
    describe?: (result: T) => Record<string, unknown>,
  ): Promise<T | null> {
    return prisma.$transaction(async (tx) => {
      const result = await fn(tx);
      if (result === null) return null;
      await writeAudit(tx, scope, {
        ...event,
        metadata: { ...event.metadata, ...(describe ? describe(result) : {}) },
      });
      return result;
    });
  }

  async function writeAudit(tx: Tx, scope: StaffScope, event: Event): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        actorId: scope.staffUserId,
        actorKind: 'staff',
        action: event.action,
        entityType: event.entityType,
        ...(event.entityId === undefined ? {} : { entityId: event.entityId }),
        metadata: {
          reason: scope.reason,
          ...event.metadata,
        } as Prisma.InputJsonValue,
        ...(scope.ip === undefined ? {} : { ip: scope.ip }),
      },
    });
  }

  return {
    // -----------------------------------------------------------------------
    // Sites
    // -----------------------------------------------------------------------

    async updateSite(scope: StaffScope, id: string, data: SiteChanges) {
      return change(
        scope,
        { action: 'site.update', entityType: 'site', entityId: id },
        async (tx) => {
          const before = await tx.site.findFirst({ where: { id, deletedAt: null } });
          if (!before) return null;
          const after = await tx.site.update({ where: { id }, data });
          // `changed` rather than the whole row: the log should say what moved,
          // not restate a record that is still there to be read.
          return { site: after, changed: diff(before, after) };
        },
        (r) => ({ changed: r.changed }),
      );
    },

    /**
     * Soft delete, and only for a site nobody has dived.
     *
     * A site with dives at it is not junk to be removed — it is where somebody
     * was — and deleting it would leave every one of those dives pointing at a
     * tombstone. The polluted ones (`site_69ab7a96…`, "Unnamed site") always
     * have dives, which is why they exist, so the tool for them is `mergeSites`
     * and this refuses and says so.
     */
    async deleteSite(scope: StaffScope, id: string) {
      return change(
        scope,
        { action: 'site.delete', entityType: 'site', entityId: id },
        async (tx) => {
          const site = await tx.site.findFirst({ where: { id, deletedAt: null } });
          if (!site) return null;

          const dives = await tx.dive.count({ where: { siteId: id, deletedAt: null } });
          if (dives > 0) {
            throw new StaffRefusal(
              'site_in_use',
              `${dives} ${dives === 1 ? 'dive is' : 'dives are'} logged at this site. ` +
                'Merge it into the right site instead, which keeps those dives and their history.',
            );
          }

          await tx.site.update({ where: { id }, data: { deletedAt: new Date() } });
          return { id, name: site.name };
        },
      );
    },

    async addSiteAlias(scope: StaffScope, siteId: string, name: string) {
      return change(
        scope,
        { action: 'site.alias.add', entityType: 'site', entityId: siteId, metadata: { name } },
        async (tx) => {
          const site = await tx.site.findFirst({ where: { id: siteId, deletedAt: null } });
          if (!site) return null;
          // `source: 'staff'` so the alias table keeps saying where each name
          // came from. An alias a person added by hand and one the importer
          // inferred are different kinds of evidence.
          const alias = await tx.siteAlias.upsert({
            where: { siteId_name: { siteId, name } },
            create: { id: randomUUID(), siteId, name, source: 'staff' },
            update: {},
          });
          return alias;
        },
      );
    },

    async removeSiteAlias(scope: StaffScope, siteId: string, aliasId: string) {
      return change(
        scope,
        { action: 'site.alias.remove', entityType: 'site', entityId: siteId },
        async (tx) => {
          const alias = await tx.siteAlias.findFirst({ where: { id: aliasId, siteId } });
          if (!alias) return null;
          await tx.siteAlias.delete({ where: { id: aliasId } });
          return { id: aliasId, name: alias.name };
        },
      );
    },

    /**
     * Fold `sourceId` into `targetId`.
     *
     * Dives move, aliases move, and the source's own name becomes an alias of
     * the target — so a diver who typed "Thousand Steps" still finds the place
     * after it is merged into "1,000 Steps". Coordinates are filled in from the
     * source only where the target has none, because a merge should never lose
     * a location and never overwrite one either.
     *
     * The source is soft-deleted rather than removed. Its id is in the audit
     * row and in nothing else; keeping the row means the merge can be
     * understood later.
     */
    async mergeSites(scope: StaffScope, sourceId: string, targetId: string) {
      return change(
        scope,
        {
          action: 'site.merge',
          entityType: 'site',
          entityId: targetId,
          metadata: { sourceId },
        },
        async (tx) => {
          const [source, target] = await Promise.all([
            tx.site.findFirst({ where: { id: sourceId, deletedAt: null } }),
            tx.site.findFirst({ where: { id: targetId, deletedAt: null } }),
          ]);
          if (!source || !target) return null;

          const moved = await tx.dive.updateMany({
            where: { siteId: sourceId },
            data: { siteId: targetId },
          });

          const names = new Set([source.name, ...(await aliasNames(tx, sourceId))]);
          const existing = new Set([target.name, ...(await aliasNames(tx, targetId))]);
          const added = [...names].filter((name) => !existing.has(name));
          if (added.length > 0) {
            await tx.siteAlias.createMany({
              data: added.map((name) => ({
                id: randomUUID(),
                siteId: targetId,
                name,
                source: 'staff',
              })),
              skipDuplicates: true,
            });
          }
          await tx.siteAlias.deleteMany({ where: { siteId: sourceId } });

          const fill: Prisma.SiteUncheckedUpdateInput = {};
          if (target.latitude === null && source.latitude !== null) {
            fill.latitude = source.latitude;
            fill.longitude = source.longitude;
          }
          if (target.maxDepthM === null && source.maxDepthM !== null) {
            fill.maxDepthM = source.maxDepthM;
          }
          if (Object.keys(fill).length > 0) {
            await tx.site.update({ where: { id: targetId }, data: fill });
          }

          await tx.site.update({ where: { id: sourceId }, data: { deletedAt: new Date() } });

          return {
            targetId,
            sourceId,
            sourceName: source.name,
            targetName: target.name,
            divesMoved: moved.count,
            aliasesAdded: added,
            filled: Object.keys(fill),
          };
        },
        (r) => ({
          sourceName: r.sourceName,
          targetName: r.targetName,
          divesMoved: r.divesMoved,
          aliasesAdded: r.aliasesAdded,
          filled: r.filled,
        }),
      );
    },

    // -----------------------------------------------------------------------
    // Tags
    // -----------------------------------------------------------------------

    /**
     * Promotion into the shared taxonomy is the interesting case: `isSystem`
     * true also clears `userId`, because a system tag belongs to nobody. The
     * unique index is `(userId, slug)`, so promoting a slug the taxonomy
     * already has would collide — caught here with a sentence rather than
     * surfacing a Prisma error code.
     */
    async updateTag(scope: StaffScope, id: string, data: TagChanges) {
      return change(
        scope,
        { action: 'tag.update', entityType: 'tag', entityId: id },
        async (tx) => {
          const before = await tx.tag.findUnique({ where: { id } });
          if (!before) return null;

          const promoting = data.isSystem === true && !before.isSystem;
          const demoting = data.isSystem === false && before.isSystem;
          if (demoting && before.userId === null) {
            throw new StaffRefusal(
              'tag_has_no_owner',
              'A system tag has no owner to demote it to. Delete it instead, or leave it shared.',
            );
          }
          if (promoting) {
            const clash = await tx.tag.findFirst({
              where: { slug: before.slug, isSystem: true, NOT: { id } },
            });
            if (clash) {
              throw new StaffRefusal(
                'tag_slug_taken',
                `The shared taxonomy already has "${before.slug}". Divers using this one should be ` +
                  'migrated onto it rather than given a second copy.',
              );
            }
          }

          const after = await tx.tag.update({
            where: { id },
            data: { ...data, ...(promoting ? { userId: null } : {}) },
          });
          return { tag: after, changed: diff(before, after) };
        },
        (r) => ({ changed: r.changed }),
      );
    },

    /**
     * Hard delete, and allowed even when dives carry it.
     *
     * The asymmetry with `deleteSite` is deliberate. A dive's site is recorded
     * information — where the person was — and losing it loses the dive's
     * meaning. A tag is a label the same dive keeps perfectly well without, and
     * junk user tags are the common case, so refusing here would leave no way
     * to clean them up. How many dives lost the label goes in the audit row,
     * because that is the part nobody can reconstruct afterwards.
     */
    async deleteTag(scope: StaffScope, id: string) {
      return change(
        scope,
        { action: 'tag.delete', entityType: 'tag', entityId: id },
        async (tx) => {
          const tag = await tx.tag.findUnique({ where: { id } });
          if (!tag) return null;
          // Counted before the delete; afterwards the join rows are gone and
          // the number nobody can reconstruct is the number nobody has.
          const dives = await tx.diveTag.count({ where: { tagId: id } });
          await tx.tag.delete({ where: { id } });
          return { id, slug: tag.slug, label: tag.label, isSystem: tag.isSystem, dives };
        },
        (r) => ({ slug: r.slug, label: r.label, isSystem: r.isSystem, dives: r.dives }),
      );
    },

    // -----------------------------------------------------------------------
    // Users
    // -----------------------------------------------------------------------

    /**
     * Suspending revokes every refresh token as well as flipping the column.
     *
     * Without that the account stays signed in on every device it is signed in
     * on — the access token is short-lived but the refresh token is not, so a
     * suspension that only writes a column takes effect somewhere between now
     * and a fortnight from now.
     */
    async setUserStatus(scope: StaffScope, id: string, status: 'active' | 'suspended') {
      return change(
        scope,
        { action: `user.${status}`, entityType: 'user', entityId: id, metadata: { status } },
        async (tx) => {
          const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
          if (!user) return null;

          await tx.user.update({ where: { id }, data: { status } });
          const revoked =
            status === 'suspended' ? await revokeSessions(tx, id, 'suspended_by_staff') : 0;

          return { id, email: user.email, from: user.status, to: status, sessionsRevoked: revoked };
        },
        (r) => ({ from: r.from, to: r.to, sessionsRevoked: r.sessionsRevoked }),
      );
    },

    /**
     * Soft delete. Never `user.delete` in Prisma: the schema cascades from
     * User to dives, sites, imports and everything else, so a hard delete here
     * is a decade of somebody's logbook gone with no undo and no tombstone for
     * their offline clients to sync.
     *
     * The row is kept, the status is set, and sessions are revoked. Actual
     * erasure is the GDPR path (`DELETE /v1/me`), which is the diver's own
     * decision with a grace period attached — not a staff button.
     */
    async deleteUser(scope: StaffScope, id: string) {
      return change(
        scope,
        { action: 'user.delete', entityType: 'user', entityId: id },
        async (tx) => {
          const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
          if (!user) return null;
          if (user.isStaff) {
            throw new StaffRefusal(
              'staff_account',
              'Staff accounts cannot be deleted from here. Remove the account from Cloudflare ' +
                'Access first, so the panel and the database do not disagree about who is staff.',
            );
          }

          await tx.user.update({
            where: { id },
            data: { deletedAt: new Date(), status: 'deleted' },
          });
          const revoked = await revokeSessions(tx, id, 'user_deleted');
          const dives = await tx.dive.count({ where: { userId: id, deletedAt: null } });

          return { id, email: user.email, dives, sessionsRevoked: revoked };
        },
        // The dive count is the part nobody can reconstruct from the row
        // afterwards, and the number a person will want when they ask what
        // this deletion actually took away.
        (r) => ({ dives: r.dives, sessionsRevoked: r.sessionsRevoked }),
      );
    },

    // -----------------------------------------------------------------------
    // Dives
    // -----------------------------------------------------------------------

    /**
     * Correct a dive, across users.
     *
     * `version` is incremented so offline clients see the change; that column
     * is the sync engine's optimistic-concurrency counter and skipping it makes
     * the correction invisible on the diver's phone.
     *
     * A caveat this cannot fix by itself: these values are applied directly,
     * not recorded as a source. If the dive is later touched by an import
     * commit or revert, `resolve()` recomputes every field from the sources on
     * record and the correction goes with it. The panel warns on dives that
     * have sources; the durable fix is a `staff` provenance source, which is a
     * larger change than this one.
     */
    async updateDive(scope: StaffScope, id: string, data: DiveChanges) {
      return change(
        scope,
        { action: 'dive.update', entityType: 'dive', entityId: id },
        async (tx) => {
          const before = await tx.dive.findFirst({ where: { id, deletedAt: null } });
          if (!before) return null;

          const wantedNumber = typeof data.diveNumber === 'number' ? data.diveNumber : undefined;
          if (wantedNumber !== undefined && wantedNumber !== before.diveNumber) {
            const taken = await tx.dive.findFirst({
              where: {
                userId: before.userId,
                diveNumber: wantedNumber,
                deletedAt: null,
                NOT: { id },
              },
            });
            if (taken) {
              throw new StaffRefusal(
                'dive_number_taken',
                `This diver already has a dive number ${wantedNumber}.`,
              );
            }
          }

          const after = await tx.dive.update({
            where: { id },
            data: { ...data, version: { increment: 1 } },
          });
          return {
            dive: after,
            userId: before.userId,
            // Notes are never selected, so they can never reach an audit row.
            changed: diff(before, after, AUDITABLE_DIVE_FIELDS),
          };
        },
        (r) => ({ userId: r.userId, changed: r.changed }),
      );
    },

    async softDeleteDive(scope: StaffScope, id: string) {
      return change(
        scope,
        { action: 'dive.delete', entityType: 'dive', entityId: id },
        async (tx) => {
          const dive = await tx.dive.findFirst({ where: { id, deletedAt: null } });
          if (!dive) return null;
          await tx.dive.update({
            where: { id },
            data: { deletedAt: new Date(), version: { increment: 1 } },
          });
          return { id, userId: dive.userId, diveNumber: dive.diveNumber };
        },
        (r) => ({ userId: r.userId, diveNumber: r.diveNumber }),
      );
    },

    async restoreDive(scope: StaffScope, id: string) {
      return change(
        scope,
        { action: 'dive.restore', entityType: 'dive', entityId: id },
        async (tx) => {
          const dive = await tx.dive.findFirst({ where: { id, deletedAt: { not: null } } });
          if (!dive) return null;
          // The partial unique index is `WHERE deleted_at IS NULL`, so a live
          // dive may have taken this number while the tombstone sat there.
          const taken = await tx.dive.findFirst({
            where: {
              userId: dive.userId,
              diveNumber: dive.diveNumber,
              deletedAt: null,
              NOT: { id },
            },
          });
          if (taken) {
            throw new StaffRefusal(
              'dive_number_taken',
              `Dive number ${dive.diveNumber} was reused while this one was deleted. ` +
                'Renumber the live dive first, then restore this one.',
            );
          }
          await tx.dive.update({
            where: { id },
            data: { deletedAt: null, version: { increment: 1 } },
          });
          return { id, userId: dive.userId, diveNumber: dive.diveNumber };
        },
        (r) => ({ userId: r.userId, diveNumber: r.diveNumber }),
      );
    },

    // -----------------------------------------------------------------------
    // Reading the log
    // -----------------------------------------------------------------------

    /**
     * Never paginated by offset and never filtered by anything a reader could
     * use to make an action disappear: the log is append-only and this is the
     * only way to read it.
     */
    async listAudit(query: {
      limit: number;
      entityType?: string;
      entityId?: string;
      actorId?: string;
    }) {
      const rows = await prisma.auditEvent.findMany({
        where: {
          ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
          ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
          ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      });

      const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id) => id !== null))];
      const actors = await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true },
      });
      const emailById = new Map(actors.map((a) => [a.id, a.email]));

      return rows.map((row) => ({
        ...row,
        actorEmail: row.actorId === null ? null : (emailById.get(row.actorId) ?? null),
      }));
    },

    /** Exposed so callers that own their own transaction can still record. */
    writeAuditIn: writeAudit,
  };
}

export type AdminRepository = ReturnType<typeof createAdminRepository>;

/**
 * What staff may change, expressed as a `Pick` of Prisma's own update input.
 *
 * A `Pick` rather than a hand-written shape so the column types stay correct
 * as the schema moves, and an allowlist rather than an `Omit` so a column
 * added later is off-limits until someone adds it here on purpose. That is the
 * mechanism keeping `notes` and `privateNotes` out of `DiveChanges`, and
 * `admin.repository.test.ts` fails if either appears.
 */
export type SiteChanges = Pick<
  Prisma.SiteUncheckedUpdateInput,
  'name' | 'latitude' | 'longitude' | 'maxDepthM' | 'typicalEntry' | 'description' | 'isPublic'
>;

export type TagChanges = Pick<Prisma.TagUncheckedUpdateInput, 'label' | 'category' | 'isSystem'>;

export type DiveChanges = Pick<
  Prisma.DiveUncheckedUpdateInput,
  | 'diveNumber'
  | 'startTimeUtc'
  | 'startTimeLocal'
  | 'tzOffsetMinutes'
  | 'durationS'
  | 'maxDepthM'
  | 'avgDepthM'
  | 'waterTempMinC'
  | 'airTempC'
  | 'visibilityM'
  | 'weightKg'
  | 'waterType'
  | 'diveMode'
  | 'siteId'
>;

/**
 * Dive columns that may appear in an audit row.
 *
 * An allowlist rather than a blocklist, for the same reason `DIVE_SELECT` in
 * the admin app is one: a column added to the schema later is excluded until
 * somebody decides otherwise, so the next personal field does not leak into
 * the log by default. `admin.repository.test.ts` fails if `notes` or
 * `privateNotes` is ever added here.
 */
export const AUDITABLE_DIVE_FIELDS = new Set([
  'diveNumber',
  'startTimeUtc',
  'startTimeLocal',
  'tzOffsetMinutes',
  'durationS',
  'maxDepthM',
  'avgDepthM',
  'waterTempMinC',
  'airTempC',
  'visibilityM',
  'weightKg',
  'waterType',
  'diveMode',
  'siteId',
]);

/** Columns that change on every write and say nothing about intent. */
const NOISE = new Set(['updatedAt', 'version']);

/**
 * What actually moved, as `{ field: [before, after] }`.
 *
 * The audit row records the change, not the record: a snapshot of every column
 * makes the log enormous and still leaves the reader diffing two blobs by eye.
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: T,
  allowed?: ReadonlySet<string>,
): Record<string, [unknown, unknown]> {
  const changed: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    if (NOISE.has(key)) continue;
    if (allowed && !allowed.has(key)) continue;
    const a = before[key];
    const b = after[key];
    if (same(a, b)) continue;
    changed[key] = [serialise(a), serialise(b)];
  }
  return changed;
}

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

const serialise = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString() : value;

async function aliasNames(tx: Tx, siteId: string): Promise<string[]> {
  const rows = await tx.siteAlias.findMany({ where: { siteId }, select: { name: true } });
  return rows.map((r) => r.name);
}

async function revokeSessions(tx: Tx, userId: string, reason: string): Promise<number> {
  const result = await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { createDiveRepository, getPrismaClient, type UserScope } from '@mydivelog/db';
import {
  computeIntervals,
  decodeProfile,
  renumberDives,
  renumberPlan,
  summarizeLog,
} from '@mydivelog/domain';
import type { CreateDive, ListDivesQuery, UpdateDive } from '@mydivelog/contracts';
import { notFound } from '../common/problem-details.ts';
import { StorageService } from '../storage/storage.service.ts';

/**
 * `startTimeLocal` is a wall-clock time with no zone — the time the diver
 * remembers. `new Date('2026-03-06T19:07:42')` would parse it in whatever zone
 * the server happens to run in, so the stored value would depend on the machine.
 * Appending Z pins it, and the column is `timestamp without time zone`, so the
 * wall clock is what round-trips.
 */
const wallClock = (iso: string): Date => new Date(iso.endsWith('Z') ? iso : `${iso}Z`);

@Injectable()
export class DivesService {
  private readonly prisma = getPrismaClient();
  private readonly repo = createDiveRepository(getPrismaClient());

  constructor(private readonly storage: StorageService) {}

  async list(scope: UserScope, query: ListDivesQuery) {
    const rows = await this.repo.list(scope, {
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.tripId ? { tripId: query.tripId } : {}),
      ...(query.hasProfile !== undefined ? { hasProfile: query.hasProfile } : {}),
      ...(query.minDepthM !== undefined ? { minDepthM: query.minDepthM } : {}),
      ...(query.maxDepthM !== undefined ? { maxDepthM: query.maxDepthM } : {}),
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });

    // The repository fetches one extra row so the caller can tell whether more
    // exist without a second count query.
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
  }

  async get(scope: UserScope, id: string) {
    // 404 rather than 403: another user's dive must not be distinguishable from
    // one that does not exist.
    const dive = await this.repo.findDetailById(scope, id);
    if (!dive) throw notFound('Dive');

    const sourceById = new Map(dive.sources.map((source) => [source.id, source]));
    const { sources, provenance, tags, buddies, site, profile, ...rest } = dive;

    return {
      ...rest,
      site: site
        ? {
            id: site.id,
            name: site.name,
            latitude: site.latitude,
            longitude: site.longitude,
          }
        : null,
      tags: tags.map((t) => ({ slug: t.tag.slug, label: t.tag.label })),
      buddies: buddies.map((b) => b.buddy.displayName),
      profile: profile
        ? {
            sampleCount: profile.sampleCount,
            maxDepthM: profile.maxDepthM,
            avgDepthM: profile.avgDepthM,
            durationS: profile.durationS,
            minTempC: profile.minTempC,
            maxTempC: profile.maxTempC,
            channels: profile.channels,
          }
        : null,
      sources: sources.map((source) => ({
        sourceKind: source.sourceKind,
        sourceRef: source.sourceRef,
        recordedAt: source.recordedAt,
      })),
      // Flattened with the source's kind attached, because a source id means
      // nothing to a diver and "your spreadsheet" means everything.
      provenance: provenance.map((row) => ({
        fieldPath: row.fieldPath,
        value: row.value,
        isSelected: row.isSelected,
        sourceKind: sourceById.get(row.sourceId)?.sourceKind ?? 'unknown',
        sourceRef: sourceById.get(row.sourceId)?.sourceRef ?? null,
        recordedAt: sourceById.get(row.sourceId)?.recordedAt ?? row.diveId,
      })),
    };
  }

  /**
   * The decoded depth profile.
   *
   * Its own request because the samples are large and most views do not need
   * them — a dive that has a profile should still list at the speed of one
   * that does not.
   */
  async profile(scope: UserScope, id: string) {
    const dive = await this.repo.findDetailById(scope, id);
    if (!dive?.profile) throw notFound('Profile');

    const blob = await this.storage.getProfile(dive.profile.storageKey);
    return decodeProfile(blob);
  }

  async create(scope: UserScope, input: CreateDive) {
    return this.repo.create(scope, {
      id: randomUUID(),
      ...input,
      startTimeUtc: new Date(input.startTimeUtc),
      startTimeLocal: wallClock(input.startTimeLocal),
    } as Parameters<typeof this.repo.create>[1]);
  }

  async update(scope: UserScope, id: string, input: UpdateDive) {
    const patch: Record<string, unknown> = { ...input };
    if (input.startTimeUtc) patch['startTimeUtc'] = new Date(input.startTimeUtc);
    if (input.startTimeLocal) patch['startTimeLocal'] = wallClock(input.startTimeLocal);

    const updated = await this.repo.update(scope, id, patch as never);
    if (!updated) throw notFound('Dive');
    return updated;
  }

  async remove(scope: UserScope, id: string) {
    if (!(await this.repo.softDelete(scope, id))) throw notFound('Dive');
  }

  async restore(scope: UserScope, id: string) {
    if (!(await this.repo.restore(scope, id))) throw notFound('Dive');
    return this.get(scope, id);
  }

  /**
   * Renumbering is a two-phase update inside one transaction: the uniqueness
   * index is partial and therefore cannot be deferred, so a single shift
   * collides with itself. See packages/domain renumberPlan.
   */
  async renumber(scope: UserScope, startAt: number) {
    const all = await this.prisma.dive.findMany({
      where: { userId: scope.userId, deletedAt: null },
      select: { id: true, startTimeUtc: true, diveNumber: true },
    });
    const changes = renumberDives(all, startAt);
    const changed = await this.repo.applyRenumbering(scope, renumberPlan(changes));
    return { changed, changes };
  }

  async summary(scope: UserScope) {
    const rows = await this.prisma.dive.findMany({
      where: { userId: scope.userId, deletedAt: null },
      select: { durationS: true, maxDepthM: true },
    });
    return summarizeLog(rows);
  }

  /** Surface intervals and repetition indices, derived rather than stored. */
  async intervals(scope: UserScope) {
    const rows = await this.prisma.dive.findMany({
      where: { userId: scope.userId, deletedAt: null },
      select: { id: true, startTimeUtc: true, durationS: true, tzOffsetMinutes: true },
    });
    return computeIntervals(rows);
  }
}

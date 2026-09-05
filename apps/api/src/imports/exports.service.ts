import { Injectable } from '@nestjs/common';
import { decodeProfile } from '@mydivelog/domain';
import { getPrismaClient, type UserScope } from '@mydivelog/db';
import {
  exportCsv,
  exportMydivelog,
  exportUddf,
  type ExportableDive,
  type Logbook,
} from '@mydivelog/importers';
import { StorageService } from '../storage/storage.service.ts';

export type ExportResult = { body: string; contentType: string; fileName: string };

/**
 * Reads a logbook out, whole.
 *
 * Export parity is a product promise. A diver who cannot get their data out is
 * being held by the logbook, and the premise of this product is that they were
 * held by something else first.
 */
@Injectable()
export class ExportsService {
  private readonly prisma = getPrismaClient();

  constructor(private readonly storage: StorageService) {}

  async export(
    scope: UserScope,
    format: 'mydivelog' | 'uddf' | 'csv',
    units: 'metric' | 'imperial',
  ): Promise<ExportResult> {
    const logbook = await this.read(scope, format === 'mydivelog');
    const stamp = new Date().toISOString().slice(0, 10);

    switch (format) {
      case 'uddf':
        return {
          body: exportUddf(logbook),
          contentType: 'application/xml; charset=utf-8',
          fileName: `mydivelog-${stamp}.uddf`,
        };
      case 'csv':
        return {
          body: exportCsv(logbook, { units }),
          contentType: 'text/csv; charset=utf-8',
          fileName: `mydivelog-${stamp}.csv`,
        };
      default:
        return {
          body: JSON.stringify(exportMydivelog(logbook), null, 2),
          contentType: 'application/json; charset=utf-8',
          fileName: `mydivelog-${stamp}.json`,
        };
    }
  }

  /**
   * `withProfiles` is false for the summary formats. Fetching and decoding
   * every profile blob to produce a CSV that has no column for them would turn
   * a cheap export into hundreds of object reads.
   */
  private async read(scope: UserScope, withProfiles: boolean): Promise<Logbook> {
    const dives = await this.prisma.dive.findMany({
      where: { userId: scope.userId, deletedAt: null },
      orderBy: { startTimeUtc: 'asc' },
      include: {
        site: true,
        profile: withProfiles,
        tags: { include: { tag: true } },
        buddies: { include: { buddy: true } },
        sources: true,
      },
    });

    const out: ExportableDive[] = [];
    for (const dive of dives) {
      const site = dive.site
        ? {
            name: dive.site.name,
            ...(dive.site.latitude === null ? {} : { lat: dive.site.latitude }),
            ...(dive.site.longitude === null ? {} : { lon: dive.site.longitude }),
            ...(dive.site.altitudeM === null ? {} : { altitudeM: dive.site.altitudeM }),
          }
        : undefined;

      out.push({
        // The logbook's own id, so a re-import is decided by identity rather
        // than re-scored — which is what stops a restored backup duplicating.
        ref: dive.id,
        diveNumber: dive.diveNumber,
        startTimeLocal: dive.startTimeLocal,
        startTimeUtc: dive.startTimeUtc,
        tzOffsetMinutes: dive.tzOffsetMinutes,
        ...(dive.durationS === null ? {} : { durationS: dive.durationS }),
        ...(dive.maxDepthM === null ? {} : { maxDepthM: dive.maxDepthM }),
        ...(dive.avgDepthM === null ? {} : { avgDepthM: dive.avgDepthM }),
        ...(dive.waterTempMinC === null ? {} : { waterTempMinC: dive.waterTempMinC }),
        ...(dive.airTempC === null ? {} : { airTempC: dive.airTempC }),
        ...(dive.visibilityM === null ? {} : { visibilityM: dive.visibilityM }),
        ...(dive.weightKg === null ? {} : { weightKg: dive.weightKg }),
        ...(dive.waterType === null ? {} : { waterType: dive.waterType }),
        ...(dive.rating === null ? {} : { rating: dive.rating }),
        ...(dive.notes === null ? {} : { notes: dive.notes }),
        ...(site ? { site } : {}),
        tags: dive.tags.map((t) => t.tag.label),
        buddies: dive.buddies.map((b) => b.buddy.displayName),
        sources: dive.sources.map((s) => ({
          sourceKind: s.sourceKind,
          ...(s.sourceRef === null ? {} : { sourceRef: s.sourceRef }),
          recordedAt: s.recordedAt,
        })),
        ...(await this.profileOf(dive.profile)),
      });
    }

    return { dives: out };
  }

  private async profileOf(
    profile: { storageKey: string } | null | undefined,
  ): Promise<{ profile?: ExportableDive['profile'] }> {
    if (!profile || !this.storage.configured) return {};
    try {
      return { profile: decodeProfile(await this.storage.getProfile(profile.storageKey)) };
    } catch {
      // A missing or unreadable blob costs this dive its profile, not the
      // whole export. A diver asking for a backup at 2am should get one.
      return {};
    }
  }
}

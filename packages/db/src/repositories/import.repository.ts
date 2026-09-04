import { randomUUID } from 'node:crypto';
import { mergeDive, selectedValues, type MergedDive } from '@mydivelog/domain';
import type { PrismaClient } from '../client.ts';
import type { UserScope } from '../scope.ts';

/**
 * Commit and revert.
 *
 * Revert is what makes import safe to try. A diver who knows they can undo
 * will import; one who is not sure will not, and a logbook is a decade of
 * someone's memory. So revert is not a convenience here — it is the feature
 * that makes the rest of the phase usable.
 */

/** What one parsed row asserts, ready to be written. */
export type CommitRow = {
  rowIndex: number;
  /** `merge` requires `diveId`; `create` makes one. */
  decision: 'create' | 'merge' | 'skip';
  diveId?: string;
  sourceKind: string;
  /** The source's own id. Combined with the batch, this is what makes a replay a no-op. */
  sourceRef?: string;
  sourceFileKey?: string;
  rawPayload?: unknown;
  /** When the source captured the dive, not when we read the file. */
  recordedAt: Date;
  fields: Record<string, unknown>;
  profile?: ProfileToStore;
};

export type ProfileToStore = {
  storageKey: string;
  format: string;
  sampleCount: number;
  byteSize: number;
  checksum: string;
  channels: string[];
  maxDepthM: number;
  avgDepthM: number;
  durationS: number;
  intervalS?: number;
  minTempC?: number;
  maxTempC?: number;
};

export type CommitResult = {
  batchId: string;
  created: string[];
  merged: string[];
  skipped: number;
  /** Rows whose source was already attached to this batch. */
  replayed: number;
};

/**
 * Fields that live in columns on `dives`. Everything else is held as
 * provenance only until the entity that owns it exists — sites and tags are
 * shared, deduplicated records rather than columns, so they get their own
 * resolution step rather than being written here.
 */
/**
 * Columns a dive cannot be without. Left alone when nothing asserts them,
 * because a dive with no start time is not a row worth keeping — if every
 * source for it is gone, the dive is deleted rather than blanked.
 */
const REQUIRED_COLUMNS = new Set(['startTimeUtc', 'startTimeLocal', 'tzOffsetMinutes']);

const DIVE_COLUMNS = {
  startTimeUtc: 'startTimeUtc',
  startTimeLocal: 'startTimeLocal',
  tzOffsetMinutes: 'tzOffsetMinutes',
  durationS: 'durationS',
  maxDepthM: 'maxDepthM',
  avgDepthM: 'avgDepthM',
  waterTempMinC: 'waterTempMinC',
  airTempC: 'airTempC',
  visibilityM: 'visibilityM',
  weightKg: 'weightKg',
  waterType: 'waterType',
  rating: 'rating',
  notes: 'notes',
} as const;

const INT_COLUMNS = new Set(['tzOffsetMinutes', 'durationS', 'rating']);

export function createImportRepository(prisma: PrismaClient) {
  return {
    /**
     * Writes a whole batch in one transaction.
     *
     * Idempotent by construction: `unique(importBatchId, sourceRef)` on
     * `DiveSource` means replaying a commit cannot attach the same source
     * twice, so a retried or duplicated request converges rather than
     * duplicating a diver's history.
     */
    async commit(
      scope: UserScope,
      batchId: string,
      rows: readonly CommitRow[],
    ): Promise<CommitResult> {
      return prisma.$transaction(async (tx) => {
        const result: CommitResult = { batchId, created: [], merged: [], skipped: 0, replayed: 0 };

        // Numbers are assigned here because sources frequently carry none —
        // the seed UDDF has none across all 96 dives.
        const highest = await tx.dive.aggregate({
          where: { userId: scope.userId, deletedAt: null },
          _max: { diveNumber: true },
        });
        let nextNumber = (highest._max.diveNumber ?? 0) + 1;

        for (const row of rows) {
          if (row.decision === 'skip') {
            result.skipped += 1;
            continue;
          }

          if (row.sourceRef !== undefined) {
            const already = await tx.diveSource.findUnique({
              where: {
                importBatchId_sourceRef: { importBatchId: batchId, sourceRef: row.sourceRef },
              },
            });
            if (already) {
              result.replayed += 1;
              continue;
            }
          }

          let diveId = row.diveId;
          if (row.decision === 'create' || diveId === undefined) {
            diveId = randomUUID();
            await tx.dive.create({
              data: {
                id: diveId,
                userId: scope.userId,
                diveNumber: nextNumber++,
                // Placeholders: the real values land in the resolution below,
                // which is the only place that decides what a dive shows.
                startTimeUtc: (row.fields['startTimeUtc'] as Date | undefined) ?? new Date(0),
                startTimeLocal: (row.fields['startTimeLocal'] as Date | undefined) ?? new Date(0),
                tzOffsetMinutes: (row.fields['tzOffsetMinutes'] as number | undefined) ?? 0,
              },
            });
            result.created.push(diveId);
          } else {
            const target = await tx.dive.findFirst({
              where: { id: diveId, userId: scope.userId, deletedAt: null },
            });
            // A dive that vanished between review and commit must not
            // resurrect as a silent create under someone else's id.
            if (!target) {
              result.skipped += 1;
              continue;
            }
            result.merged.push(diveId);
          }

          const sourceId = randomUUID();
          await tx.diveSource.create({
            data: {
              id: sourceId,
              diveId,
              importBatchId: batchId,
              sourceKind: row.sourceKind,
              sourceRef: row.sourceRef ?? null,
              sourceFileKey: row.sourceFileKey ?? null,
              rawPayload: (row.rawPayload ?? null) as never,
              recordedAt: row.recordedAt,
            },
          });

          await writeProvenance(tx, diveId, sourceId, row.fields);
          if (row.profile) await writeProfile(tx, diveId, row.profile);
          await resolve(tx, diveId);
        }

        await tx.importBatch.update({
          where: { id: batchId },
          data: { status: 'committed', committedAt: new Date() },
        });

        return result;
      });
    },

    /**
     * Undoes a batch, leaving everything else exactly as it was.
     *
     * Sources from the batch are removed, every field they touched is
     * re-resolved from what remains, and dives whose only source was this
     * batch are deleted. A dive that pre-existed returns to its prior state
     * rather than to a default — which is why provenance records every
     * assertion rather than only the winning one.
     */
    async revert(
      scope: UserScope,
      batchId: string,
    ): Promise<{ deleted: string[]; restored: string[] }> {
      return prisma.$transaction(async (tx) => {
        const batch = await tx.importBatch.findFirst({
          where: { id: batchId, userId: scope.userId },
        });
        if (!batch) throw new Error(`Import batch ${batchId} does not belong to this user.`);

        const sources = await tx.diveSource.findMany({
          where: { importBatchId: batchId },
          select: { id: true, diveId: true },
        });
        const touched = [...new Set(sources.map((s) => s.diveId))];

        // Provenance cascades from the source, so removing sources removes
        // exactly the assertions this batch made and nothing else.
        await tx.diveSource.deleteMany({ where: { importBatchId: batchId } });

        const deleted: string[] = [];
        const restored: string[] = [];

        for (const diveId of touched) {
          const remaining = await tx.diveSource.count({ where: { diveId } });
          if (remaining === 0) {
            await tx.dive.delete({ where: { id: diveId } });
            deleted.push(diveId);
            continue;
          }
          await resolve(tx, diveId);
          restored.push(diveId);
        }

        await tx.importBatch.update({
          where: { id: batchId },
          data: { status: 'reverted', revertedAt: new Date() },
        });

        return { deleted, restored };
      });
    },
  };
}

export type ImportRepository = ReturnType<typeof createImportRepository>;

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function writeProvenance(
  tx: Tx,
  diveId: string,
  sourceId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const rows = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([fieldPath, value]) => ({
      diveId,
      fieldPath,
      sourceId,
      value: serialize(value) as never,
      isSelected: false,
      confidence: 1,
    }));
  if (rows.length > 0) await tx.diveFieldProvenance.createMany({ data: rows });
}

async function writeProfile(tx: Tx, diveId: string, profile: ProfileToStore): Promise<void> {
  await tx.diveProfile.upsert({
    where: { diveId },
    create: {
      id: randomUUID(),
      diveId,
      storageKey: profile.storageKey,
      format: profile.format,
      sampleCount: profile.sampleCount,
      byteSize: profile.byteSize,
      checksum: profile.checksum,
      channels: profile.channels,
      maxDepthM: profile.maxDepthM,
      avgDepthM: profile.avgDepthM,
      durationS: profile.durationS,
      intervalS: profile.intervalS ?? null,
      minTempC: profile.minTempC ?? null,
      maxTempC: profile.maxTempC ?? null,
    },
    update: {
      storageKey: profile.storageKey,
      sampleCount: profile.sampleCount,
      byteSize: profile.byteSize,
      checksum: profile.checksum,
    },
  });
  await tx.dive.update({ where: { id: diveId }, data: { hasProfile: true } });
}

/**
 * Recomputes what a dive shows from every source still attached to it.
 *
 * Deliberately re-derived from scratch rather than applied incrementally. An
 * incremental update cannot undo itself, and revert is exactly the operation
 * that needs the answer to be a function of what remains rather than of the
 * order things arrived in.
 *
 * Every managed column is written on every pass, including to null. Writing
 * only the fields that have values is the natural way to do this and it is
 * wrong: after a revert the dive keeps whatever the removed source had
 * contributed alone, so the record still claims a duration nothing measured.
 */
async function resolve(tx: Tx, diveId: string): Promise<void> {
  const sources = await tx.diveSource.findMany({
    where: { diveId },
    include: { provenance: true },
  });

  const merged: MergedDive = mergeDive(
    sources.map((source) => ({
      sourceId: source.id,
      sourceKind: source.sourceKind,
      recordedAt: source.recordedAt,
      fields: Object.fromEntries(
        source.provenance.map((p) => [p.fieldPath, deserialize(p.fieldPath, p.value)]),
      ),
      sensedFields: SENSED_BY_KIND[source.sourceKind] ?? [],
    })),
  );

  const values = selectedValues(merged);
  const data: Record<string, unknown> = { hasContestedFields: merged.hasContestedFields };

  for (const [path, column] of Object.entries(DIVE_COLUMNS)) {
    const value = values[path];
    if (value === undefined) {
      // Cleared, not skipped. A field whose only source has been reverted has
      // to go back to empty, or revert leaves the value behind and the dive
      // claims a duration nothing measured. Skipping here passed every test
      // except the one that mattered.
      if (!REQUIRED_COLUMNS.has(path)) data[column] = null;
      continue;
    }
    data[column] = INT_COLUMNS.has(column) ? Math.round(Number(value)) : value;
  }
  await tx.dive.update({ where: { id: diveId }, data: data as never });

  // Mark which assertion each field is currently showing, so the UI can say
  // where a value came from without recomputing the merge.
  const selectedBySource = new Map<string, Set<string>>();
  for (const resolution of Object.values(merged.fields)) {
    for (const p of resolution.provenance) {
      if (!p.isSelected) continue;
      const set = selectedBySource.get(p.sourceId) ?? new Set<string>();
      set.add(p.fieldPath);
      selectedBySource.set(p.sourceId, set);
    }
  }

  await tx.diveFieldProvenance.updateMany({ where: { diveId }, data: { isSelected: false } });
  for (const [sourceId, paths] of selectedBySource) {
    await tx.diveFieldProvenance.updateMany({
      where: { diveId, sourceId, fieldPath: { in: [...paths] } },
      data: { isSelected: true },
    });
  }
}

/** Which fields an instrument measured rather than was told. */
const SENSED_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  uddf: ['gases', 'profile', 'waterTempMinC'],
};

/** Dates do not survive a JSON round trip, so they are tagged going in. */
const DATE_PREFIX = '@date:';

function serialize(value: unknown): unknown {
  if (value instanceof Date) return `${DATE_PREFIX}${value.toISOString()}`;
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

function deserialize(_fieldPath: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(DATE_PREFIX)) {
    return new Date(value.slice(DATE_PREFIX.length));
  }
  if (Array.isArray(value)) return value.map((v) => deserialize(_fieldPath, v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, deserialize(_fieldPath, v)]),
    );
  }
  return value;
}

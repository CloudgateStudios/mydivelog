import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  assignBatch,
  encodeProfile,
  summarizeProfile,
  type DiveObservation,
  type MatchCandidate,
  type ProfileSeries,
} from '@mydivelog/domain';
import {
  createImportRepository,
  getPrismaClient,
  userScope,
  type CommitRow,
  type UserScope,
} from '@mydivelog/db';
import {
  detectFormat,
  parseCsv,
  parseMydivelog,
  parseTabular,
  parseUddf,
  type DetectedFormat,
} from '@mydivelog/importers';
import { badRequest, notFound } from '../common/problem-details.ts';
import { StorageService, sha256 } from '../storage/storage.service.ts';
import { observationFields } from './fields.ts';
import { resolveTimezone } from './timezone.resolver.ts';

/**
 * The import pipeline, wired to a database.
 *
 * Parse, normalize and match are pure and live in packages; this is the part
 * that stores a file, remembers what was proposed, and lets a human change it
 * before anything is written to their logbook.
 */
/**
 * Enough to hide the latency of a round trip, few enough that a 512 MB machine
 * is not holding a hundred encoded profiles at once.
 */
const PROFILE_UPLOAD_CONCURRENCY = 8;

/**
 * `Promise.all` in slices, keeping the results in the order they were given.
 *
 * Not `Promise.all` over everything: ninety-six simultaneous uploads is a
 * different failure from ninety-six sequential ones, and this code runs on a
 * small shared machine.
 */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  private readonly prisma = getPrismaClient();
  private readonly repo = createImportRepository(getPrismaClient());

  constructor(private readonly storage: StorageService) {}

  /**
   * Stores the file, parses it, matches every row against the diver's existing
   * dives, and returns the proposal. Nothing is written to the logbook here —
   * that is what commit is for.
   */
  async create(
    scope: UserScope,
    fileName: string,
    bytes: Uint8Array,
    override?: DetectedFormat,
  ): Promise<string> {
    const text = new TextDecoder().decode(bytes);
    const checksum = sha256(bytes);

    // An identical re-upload short-circuits to the batch that already exists,
    // so a double-submitted form does not produce two reviews of one file.
    const existing = await this.prisma.importBatch.findFirst({
      where: { userId: scope.userId, checksum, status: { notIn: ['failed'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing.id;

    const detection = detectFormat(text, fileName);
    const format = override ?? detection.format;
    const batchId = randomUUID();

    const key = this.storage.uploadKey(scope.userId, batchId, fileName);
    if (this.storage.configured) {
      await this.storage.putUpload(key, bytes, 'application/octet-stream');
    } else {
      // Local development without MinIO running. The parse still works; only
      // re-parsing later from the original file does not.
      this.logger.warn('object storage is not configured; the uploaded file was not retained');
    }

    await this.prisma.importBatch.create({
      data: {
        id: batchId,
        userId: scope.userId,
        sourceKind: format,
        originalFileKey: key,
        originalFileName: fileName,
        fileSize: bytes.byteLength,
        checksum,
        detectedFormat: detection.format,
        status: 'parsing',
      },
    });

    try {
      await this.parseAndMatch(scope, batchId, format, text);
    } catch (err) {
      // A file that cannot be parsed fails its batch, not the request. The
      // diver gets a review screen that says what went wrong rather than a 500.
      const reason = reasonFor(err);
      this.logger.warn(`import ${batchId} failed to parse: ${reason}`);
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { status: 'failed', error: reason.slice(0, 500) },
      });
    }

    return batchId;
  }

  private async parseAndMatch(
    scope: UserScope,
    batchId: string,
    format: DetectedFormat,
    text: string,
  ): Promise<void> {
    const parsed = this.parse(format, text);
    if (parsed.observations.length === 0) {
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          status: 'failed',
          error: parsed.fileIssues[0]?.message ?? 'This file contains no dives.',
        },
      });
      return;
    }

    const candidates = await this.candidates(scope);
    const assignments = assignBatch(parsed.observations, candidates);

    const rows = assignments.map((assignment) => {
      const observation = parsed.observations[assignment.observationIndex] as DiveObservation;
      const outcome = assignment.outcome;
      // Only a confident match is pre-selected. Ambiguous stays pending, so a
      // diver is deciding rather than un-deciding.
      const decision =
        outcome.decision === 'merge'
          ? 'merge'
          : outcome.decision === 'create'
            ? 'create'
            : 'pending';

      return {
        id: randomUUID(),
        batchId,
        rowIndex: assignment.observationIndex,
        raw: (observation.raw ?? null) as never,
        observation: serializable(observationFields(observation)) as never,
        normalizations: observation.normalizations as never,
        issues: [
          ...observation.issues,
          ...(outcome.note
            ? [{ severity: 'info', code: 'needs_review', message: outcome.note }]
            : []),
        ] as never,
        matchDiveId: outcome.best?.candidateId ?? null,
        matchScore: outcome.best?.score ?? null,
        matchReasons: (outcome.best?.reasons ?? []) as never,
        decision,
        decidedBy: 'auto',
      };
    });

    await this.prisma.importRow.createMany({ data: rows });
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'review', stats: statsOf(rows, parsed.observations) as never },
    });
  }

  private parse(
    format: DetectedFormat,
    text: string,
  ): { observations: DiveObservation[]; fileIssues: { message: string }[] } {
    switch (format) {
      case 'uddf':
        // With the resolver wired, a malformed offset is corrected when the
        // site's coordinates independently agree, and left flagged when they
        // do not. Without it every dive in the seed file goes to review.
        return parseUddf(text, { resolveTz: resolveTimezone });
      case 'mydivelog':
        return parseMydivelog(text);
      case 'spreadsheet': {
        const table = parseCsv(text);
        const result = parseTabular(table.headers, table.rows);
        return { observations: result.observations, fileIssues: result.fileIssues };
      }
      default:
        throw badRequest(
          'This file is not in a format MyDiveLog can read yet.',
          'unsupported_format',
        );
    }
  }

  /**
   * Existing dives, narrowed to what matching needs.
   *
   * Gases come from provenance rather than a column, because that is where the
   * importer records them. Omitting them cost every match the gas signal's
   * 0.05 — which left the seed files merging at exactly 0.80, the threshold
   * itself, with no margin at all. The pure pipeline scored the same dives
   * 0.85, and the difference was invisible because both merge.
   */
  private async candidates(scope: UserScope): Promise<MatchCandidate[]> {
    const dives = await this.prisma.dive.findMany({
      where: { userId: scope.userId, deletedAt: null },
      include: {
        site: true,
        sources: { select: { sourceRef: true } },
        provenance: { where: { fieldPath: 'gases', isSelected: true } },
      },
    });
    return dives.map((dive) => ({
      id: dive.id,
      startTimeUtc: dive.startTimeUtc,
      startTimeLocal: dive.startTimeLocal,
      ...(dive.durationS === null ? {} : { durationS: dive.durationS }),
      ...(dive.maxDepthM === null ? {} : { maxDepthM: dive.maxDepthM }),
      ...(dive.site
        ? {
            site: {
              name: dive.site.name,
              ...(dive.site.latitude === null ? {} : { lat: dive.site.latitude }),
              ...(dive.site.longitude === null ? {} : { lon: dive.site.longitude }),
            },
          }
        : {}),
      ...gasesOf(dive.provenance),
      sourceRefs: dive.sources.flatMap((s) => (s.sourceRef ? [s.sourceRef] : [])),
    }));
  }

  async get(scope: UserScope, batchId: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, userId: scope.userId },
      include: { rows: { orderBy: { rowIndex: 'asc' } } },
    });
    if (!batch) throw notFound('Import');
    return batch;
  }

  async list(scope: UserScope) {
    return this.prisma.importBatch.findMany({
      where: { userId: scope.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async updateRow(
    scope: UserScope,
    batchId: string,
    rowIndex: number,
    decision: 'create' | 'merge' | 'skip',
    matchDiveId?: string | null,
  ) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, userId: scope.userId },
    });
    if (!batch) throw notFound('Import');
    if (batch.status !== 'review') {
      throw badRequest(
        `This import is ${batch.status}; only an import awaiting review can be changed.`,
        'not_in_review',
      );
    }

    if (decision === 'merge') {
      const target = matchDiveId ?? undefined;
      if (!target) throw badRequest('Merging needs a dive to merge onto.', 'missing_dive');
      // Checked here as well as at commit. A dive id from a review screen is
      // not a capability, and the earlier the mismatch surfaces the clearer it
      // is to the person who caused it.
      const dive = await this.prisma.dive.findFirst({
        where: { id: target, userId: scope.userId, deletedAt: null },
      });
      if (!dive) throw notFound('Dive');
    }

    await this.prisma.importRow.update({
      where: { batchId_rowIndex: { batchId, rowIndex } },
      data: {
        decision,
        decidedBy: 'user',
        matchDiveId: decision === 'merge' ? (matchDiveId as string) : null,
      },
    });
  }

  async commit(scope: UserScope, batchId: string) {
    const batch = await this.get(scope, batchId);
    if (batch.status === 'committed') {
      throw badRequest('This import has already been committed.', 'already_committed');
    }
    if (batch.status !== 'review') {
      throw badRequest(`This import is ${batch.status} and cannot be committed.`, 'not_in_review');
    }

    const prepared = batch.rows.map((row) => {
      const fields = deserialize(row.observation as Record<string, unknown>);
      const profile = fields['profile'] as ProfileSeries | undefined;
      // The samples are far too large for a JSON provenance column. The
      // repository records the fact that this source had a profile.
      delete fields['profile'];
      return { row, fields, profile };
    });

    /*
     * Every profile is uploaded before the transaction opens, and they go up
     * several at a time.
     *
     * They were done one per row inside the loop below, which meant a 96-dive
     * export was 96 strictly sequential round trips to object storage. Against
     * a local MinIO that is four seconds; against R2 from a Fly machine it is
     * most of a minute, during which the import button appears to do nothing.
     *
     * They are independent and keyed by content hash, so order does not matter
     * and a repeat is a no-op. The concurrency is bounded because the machine
     * has 512 MB and each encoded profile is held in memory while it uploads.
     */
    const stored = await inBatches(prepared, PROFILE_UPLOAD_CONCURRENCY, async (item) =>
      item.profile ? this.storeProfile(scope, item.profile) : undefined,
    );

    const rows: CommitRow[] = prepared.map(({ row, fields }, index) => {
      const profile = stored[index];
      return {
        rowIndex: row.rowIndex,
        // A row nobody decided is not imported. Pending means the engine was
        // not sure and the diver did not say.
        decision:
          row.decision === 'merge' ? 'merge' : row.decision === 'create' ? 'create' : 'skip',
        ...(row.matchDiveId === null ? {} : { diveId: row.matchDiveId }),
        sourceKind: batch.sourceKind,
        ...(sourceRefOf(row.raw) === undefined ? {} : { sourceRef: sourceRefOf(row.raw) }),
        sourceFileKey: batch.originalFileKey,
        rawPayload: row.raw,
        // When the source says the dive happened, not when we read the file.
        //
        // Import time was the fallback, which quietly made every spreadsheet
        // look newer than every computer export — and "most recent wins" is
        // the tiebreak between sources of equal standing, so a spreadsheet
        // imported today would beat a watch's reading from March on any field
        // where neither outranks the other.
        recordedAt:
          (fields['startTimeUtc'] as Date | undefined) ??
          (fields['startTimeLocal'] as Date | undefined) ??
          new Date(),
        fields,
        ...(profile ? { profile } : {}),
      };
    });

    return this.repo.commit(scope, batchId, rows);
  }

  /**
   * Encodes and uploads a profile, returning what the database should record.
   *
   * Written before the transaction on purpose. An orphaned blob is cheap and a
   * sweeper collects it; a dive row pointing at a blob that was never written
   * is a broken record with no way back.
   */
  private async storeProfile(scope: UserScope, series: ProfileSeries) {
    const encoded = encodeProfile(series);
    const summary = summarizeProfile(series);
    // Keyed by content: the same profile arriving twice is one object, and a
    // retried commit overwrites itself rather than accumulating.
    const key = this.storage.profileKey(scope.userId, sha256(encoded).slice(0, 32));

    if (this.storage.configured) await this.storage.putProfile(key, encoded);

    return {
      storageKey: key,
      format: 'mdl-profile-v1',
      sampleCount: series.timeS?.length ?? 0,
      byteSize: encoded.byteLength,
      checksum: sha256(encoded),
      channels: Object.keys(series),
      maxDepthM: summary.maxDepthM,
      avgDepthM: summary.avgDepthM,
      durationS: summary.durationS,
      ...(summary.minTempC === undefined ? {} : { minTempC: summary.minTempC }),
      ...(summary.maxTempC === undefined ? {} : { maxTempC: summary.maxTempC }),
    };
  }

  async revert(scope: UserScope, batchId: string) {
    const batch = await this.get(scope, batchId);
    if (batch.status !== 'committed') {
      throw badRequest(
        `This import is ${batch.status}; only a committed import can be reverted.`,
        'not_committed',
      );
    }
    return this.repo.revert(scope, batchId);
  }
}

/**
 * The sentence to show a diver.
 *
 * `String(problemException)` is `'ProblemException: Problem Exception'` — the
 * class name and a placeholder, with the actual reason sitting in the response
 * body. Storing that as a batch's error defeats the point of failing the batch
 * instead of the request: the diver is told something went wrong and nothing
 * about what.
 */
function reasonFor(err: unknown): string {
  const response = (err as { getResponse?: () => unknown }).getResponse?.();
  const detail = (response as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  if (err instanceof Error && err.message.length > 0) return err.message;
  return String(err);
}

function gasesOf(provenance: readonly { value: unknown }[]): { gases?: { o2Fraction: number }[] } {
  const value = provenance[0]?.value;
  if (!Array.isArray(value)) return {};
  const gases = value.filter(
    (g): g is { o2Fraction: number } =>
      typeof g === 'object' &&
      g !== null &&
      typeof (g as { o2Fraction?: unknown }).o2Fraction === 'number',
  );
  return gases.length > 0 ? { gases } : {};
}

const sourceRefOf = (raw: unknown): string | undefined => {
  if (raw && typeof raw === 'object' && '@id' in raw) {
    const id = (raw as { '@id'?: unknown })['@id'];
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
};

/** Dates do not survive JSON, so they are tagged going in and read back out. */
const DATE_PREFIX = '@date:';

function serializable(value: unknown): unknown {
  if (value instanceof Date) return `${DATE_PREFIX}${value.toISOString()}`;
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializable(v)]));
  }
  return value;
}

function deserialize(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = typeof v === 'string' && v.startsWith(DATE_PREFIX) ? new Date(v.slice(6)) : v;
  }
  return out;
}

function statsOf(
  rows: readonly { decision: string }[],
  observations: readonly DiveObservation[],
): Record<string, number> {
  const count = (decision: string): number => rows.filter((r) => r.decision === decision).length;
  return {
    parsed: observations.length,
    create: count('create'),
    merge: count('merge'),
    review: count('pending'),
    skip: count('skip'),
    normalized: observations.reduce((n, o) => n + o.normalizations.length, 0),
    issues: observations.reduce((n, o) => n + o.issues.length, 0),
  };
}

export { userScope };

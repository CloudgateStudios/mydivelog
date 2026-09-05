import type { ImportBatch, ImportBatchDetail, ImportRow } from '@mydivelog/contracts';

/**
 * Database rows to API shapes.
 *
 * Kept apart from the service so what a client sees is a deliberate decision
 * rather than whatever a Prisma include happened to pull. `raw` in particular
 * never leaves: it is the source's untouched payload, useful for support and
 * far larger than a review screen needs.
 */

type BatchRow = {
  id: string;
  status: string;
  sourceKind: string;
  detectedFormat: string | null;
  originalFileName: string;
  fileSize: number;
  createdAt: Date;
  committedAt: Date | null;
  revertedAt: Date | null;
  stats: unknown;
  error: string | null;
};

export function toBatchSummary(batch: BatchRow): ImportBatch {
  return {
    id: batch.id,
    status: batch.status as ImportBatch['status'],
    sourceKind: batch.sourceKind as ImportBatch['sourceKind'],
    detectedFormat: batch.detectedFormat,
    originalFileName: batch.originalFileName,
    fileSize: batch.fileSize,
    createdAt: batch.createdAt.toISOString(),
    committedAt: batch.committedAt?.toISOString() ?? null,
    revertedAt: batch.revertedAt?.toISOString() ?? null,
    stats: batch.stats as ImportBatch['stats'],
    error: batch.error,
  };
}

type StoredRow = {
  rowIndex: number;
  decision: string;
  decidedBy: string | null;
  matchDiveId: string | null;
  matchScore: number | null;
  matchReasons: unknown;
  issues: unknown;
  normalizations: unknown;
  observation: unknown;
};

export function toBatchDetail(batch: BatchRow & { rows: StoredRow[] }): ImportBatchDetail {
  return {
    ...toBatchSummary(batch),
    rows: batch.rows.map(toRow),
    unmappedColumns: [],
    derivedColumns: [],
    tagProposals: [],
  };
}

function toRow(row: StoredRow): ImportRow {
  const observation = (row.observation ?? {}) as Record<string, unknown>;
  const local = observation['startTimeLocal'];

  return {
    rowIndex: row.rowIndex,
    decision: row.decision as ImportRow['decision'],
    decidedBy: row.decidedBy as ImportRow['decidedBy'],
    matchDiveId: row.matchDiveId,
    matchScore: row.matchScore,
    matchReasons: (row.matchReasons ?? []) as ImportRow['matchReasons'],
    note: null,
    issues: (row.issues ?? []) as ImportRow['issues'],
    normalizations: (row.normalizations ?? []) as ImportRow['normalizations'],
    preview: {
      // Stored with an `@date:` tag so it survives JSON; shown without it.
      startTimeLocal: typeof local === 'string' ? local.replace(/^@date:/, '') : null,
      tzOffsetMinutes: numberOr(observation['tzOffsetMinutes']),
      durationS: numberOr(observation['durationS']),
      maxDepthM: numberOr(observation['maxDepthM']),
      siteName: typeof observation['site.name'] === 'string' ? observation['site.name'] : null,
      hasProfile: observation['profile'] !== undefined,
    },
  };
}

const numberOr = (value: unknown): number | null => (typeof value === 'number' ? value : null);

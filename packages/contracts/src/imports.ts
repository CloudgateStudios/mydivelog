import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.ts';

/**
 * The largest file an import will accept.
 *
 * Lives here because both sides need it and they must agree: the API rejects
 * anything larger, and the web app has to know before it posts — a Server
 * Action buffers the whole body in memory, so an oversized upload fails inside
 * Next before any of our code runs and produces a blank 500.
 *
 * 32 MB is a real ceiling rather than a round number: the real 96-dive
 * Oceanic+ export is 4.4 MB, so this is roughly seven hundred dives with full
 * depth profiles. It is bounded by the web VM's memory, not by ambition —
 * docs/10-security-privacy.md wants 100 MB, and that needs the presigned
 * direct-to-storage upload it describes, which is designed and not built.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * Import is a staged pipeline with human review, never a direct write. These
 * are the shapes that make that reviewable: what a file was read as, what the
 * engine proposes for each row, and what the diver decided.
 */

export const ImportSourceKind = z.enum([
  'uddf',
  'spreadsheet',
  'mydivelog',
  'subsurface',
  'unknown',
]);

export const ImportStatus = z.enum([
  'uploaded',
  'parsing',
  'review',
  'committing',
  'committed',
  'failed',
  'reverted',
]);

export const RowDecision = z.enum(['pending', 'create', 'merge', 'skip']);

export const IssueSeverity = z.enum(['info', 'warning', 'error']);

export const Issue = z.object({
  severity: IssueSeverity,
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
});

/**
 * A value the pipeline changed and why. Surfaced in review rather than applied
 * silently — the seed UDDF's offsets are rewritten on every one of its dives,
 * and a silent rewrite of someone's dive times is indistinguishable from a bug.
 */
export const Normalization = z.object({
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
  reason: z.string(),
  confidence: z.enum(['high', 'low']),
});

export const MatchReason = z.object({
  signal: z.string(),
  weight: z.number(),
  detail: z.string(),
});

export const ImportRow = z.object({
  rowIndex: z.number().int().nonnegative(),
  decision: RowDecision,
  decidedBy: z.enum(['auto', 'user']).nullish(),
  /** The dive this row would merge onto, when it has one. */
  matchDiveId: Uuid.nullish(),
  matchScore: z.number().min(0).max(1).nullish(),
  matchReasons: z.array(MatchReason).default([]),
  /** Why the engine declined to decide, when it did. */
  note: z.string().nullish(),
  issues: z.array(Issue).default([]),
  normalizations: z.array(Normalization).default([]),
  /** Enough of the parsed dive to review it without fetching more. */
  preview: z.object({
    startTimeLocal: z.string().nullish(),
    tzOffsetMinutes: z.number().int().nullish(),
    durationS: z.number().nullish(),
    maxDepthM: z.number().nullish(),
    siteName: z.string().nullish(),
    hasProfile: z.boolean().default(false),
  }),
});
export type ImportRow = z.infer<typeof ImportRow>;

export const ImportBatch = z.object({
  id: Uuid,
  status: ImportStatus,
  sourceKind: ImportSourceKind,
  detectedFormat: z.string().nullish(),
  originalFileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
  committedAt: IsoDateTime.nullish(),
  revertedAt: IsoDateTime.nullish(),
  stats: z
    .object({
      parsed: z.number().int(),
      create: z.number().int(),
      merge: z.number().int(),
      review: z.number().int(),
      skip: z.number().int(),
      normalized: z.number().int(),
      issues: z.number().int(),
    })
    .nullish(),
  error: z.string().nullish(),
});
export type ImportBatch = z.infer<typeof ImportBatch>;

export const ImportBatchDetail = ImportBatch.extend({
  rows: z.array(ImportRow),
  /** Headers a tabular mapping ignored. Shown so nothing is dropped invisibly. */
  unmappedColumns: z.array(z.string()).default([]),
  /** Columns detected as rollups of others, defaulted to ignore. */
  derivedColumns: z
    .array(z.object({ column: z.string(), kind: z.string(), explanation: z.string() }))
    .default([]),
  /** One question per distinct written tag, not one per row. */
  tagProposals: z
    .array(
      z.object({
        input: z.string(),
        kind: z.string(),
        slug: z.string(),
        label: z.string(),
        occurrences: z.number().int(),
      }),
    )
    .default([]),
});
export type ImportBatchDetail = z.infer<typeof ImportBatchDetail>;

/** Upload is multipart; this is what accompanies the file. */
export const CreateImport = z.object({
  fileName: z.string().min(1).max(255),
  /** Overrides sniffing, for a file whose contents are ambiguous. */
  sourceKind: ImportSourceKind.optional(),
});
export type CreateImport = z.infer<typeof CreateImport>;

export const UpdateImportRow = z.object({
  decision: z.enum(['create', 'merge', 'skip']),
  /** Required when merging: which existing dive to merge onto. */
  matchDiveId: Uuid.nullish(),
});
export type UpdateImportRow = z.infer<typeof UpdateImportRow>;

export const CommitImportResult = z.object({
  batchId: Uuid,
  created: z.number().int(),
  merged: z.number().int(),
  skipped: z.number().int(),
  replayed: z.number().int(),
});
export type CommitImportResult = z.infer<typeof CommitImportResult>;

export const RevertImportResult = z.object({
  batchId: Uuid,
  deleted: z.number().int(),
  restored: z.number().int(),
});
export type RevertImportResult = z.infer<typeof RevertImportResult>;

export const ExportFormat = z.enum(['mydivelog', 'uddf', 'csv']);
export const ExportQuery = z.object({
  format: ExportFormat.default('mydivelog'),
  units: z.enum(['metric', 'imperial']).default('metric'),
});
export type ExportQuery = z.infer<typeof ExportQuery>;

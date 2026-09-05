import { apiFetch, apiJson } from './api';

/** Shapes the import screens read. Mirrors packages/contracts/src/imports.ts. */

export type ImportRow = {
  rowIndex: number;
  decision: 'pending' | 'create' | 'merge' | 'skip';
  decidedBy: string | null;
  matchDiveId: string | null;
  matchScore: number | null;
  matchReasons: { signal: string; detail: string }[];
  issues: { severity: string; code: string; message: string }[];
  normalizations: {
    field: string;
    from: unknown;
    to: unknown;
    reason: string;
    confidence: string;
  }[];
  preview: {
    startTimeLocal: string | null;
    tzOffsetMinutes: number | null;
    durationS: number | null;
    maxDepthM: number | null;
    siteName: string | null;
    hasProfile: boolean;
  };
};

export type ImportBatch = {
  id: string;
  status: 'uploaded' | 'parsing' | 'review' | 'committing' | 'committed' | 'failed' | 'reverted';
  sourceKind: string;
  detectedFormat: string | null;
  originalFileName: string;
  fileSize: number;
  createdAt: string;
  committedAt: string | null;
  revertedAt: string | null;
  error: string | null;
  stats: Record<string, number> | null;
  rows: ImportRow[];
};

export const getImport = (id: string): Promise<ImportBatch> =>
  apiJson<ImportBatch>(`/v1/imports/${id}`);

export const listImports = (): Promise<{ data: Omit<ImportBatch, 'rows'>[] }> =>
  apiJson<{ data: Omit<ImportBatch, 'rows'>[] }>('/v1/imports');

/**
 * Uploads a file and returns the batch the API created.
 *
 * The file is forwarded as multipart rather than read into memory and
 * re-encoded: a UDDF with a decade of profiles in it is not small, and the
 * server has no reason to hold a second copy.
 */
export async function uploadImport(file: File): Promise<ImportBatch> {
  const form = new FormData();
  form.set('file', file, file.name);
  const response = await apiFetch('/v1/imports', { method: 'POST', body: form });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(problem.detail ?? `Upload failed (${response.status}).`);
  }
  return (await response.json()) as ImportBatch;
}

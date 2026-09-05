import { db } from '../../lib/db';
import { dateTime, shortId } from '../../lib/format';

export const dynamic = 'force-dynamic';

/**
 * Format health.
 *
 * Which formats divers actually bring, how often each one fails, and what goes
 * wrong when it does. Every importer is written against one real file; this is
 * where the second, third and hundredth file report back.
 *
 * The issue counts are the useful part. A code that appears on nearly every
 * row of a format is not a data problem — it is a parser that has not learned
 * something yet.
 */
export default async function Health() {
  const batches = await db.importBatch.findMany({
    select: {
      id: true,
      sourceKind: true,
      detectedFormat: true,
      status: true,
      error: true,
      stats: true,
      createdAt: true,
      _count: { select: { rows: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  const rows = await db.importRow.findMany({
    select: { issues: true, normalizations: true, decision: true, batchId: true },
    take: 20_000,
  });
  const batchKind = new Map(batches.map((b) => [b.id, b.sourceKind]));

  // Per format.
  const formats = new Map<
    string,
    { batches: number; failed: number; rows: number; committed: number }
  >();
  for (const batch of batches) {
    const f = formats.get(batch.sourceKind) ?? { batches: 0, failed: 0, rows: 0, committed: 0 };
    f.batches += 1;
    if (batch.status === 'failed') f.failed += 1;
    if (batch.status === 'committed') f.committed += 1;
    f.rows += batch._count.rows;
    formats.set(batch.sourceKind, f);
  }

  // Issue codes, and which format they come from.
  const issues = new Map<string, { count: number; formats: Set<string>; example: string }>();
  const normalizations = new Map<string, { count: number; low: number; example: string }>();
  for (const row of rows) {
    const kind = batchKind.get(row.batchId) ?? 'unknown';
    for (const issue of (row.issues ?? []) as { code: string; message: string }[]) {
      const entry = issues.get(issue.code) ?? {
        count: 0,
        formats: new Set<string>(),
        example: issue.message,
      };
      entry.count += 1;
      entry.formats.add(kind);
      issues.set(issue.code, entry);
    }
    for (const n of (row.normalizations ?? []) as {
      field: string;
      reason: string;
      confidence: string;
    }[]) {
      const entry = normalizations.get(n.field) ?? { count: 0, low: 0, example: n.reason };
      entry.count += 1;
      if (n.confidence === 'low') entry.low += 1;
      normalizations.set(n.field, entry);
    }
  }

  const failures = batches.filter((b) => b.status === 'failed').slice(0, 20);

  return (
    <main>
      <h1>Format health</h1>
      <p className="lede">
        Every importer is written against one real file. This is where the second, third and
        hundredth file report back — and an issue code appearing on nearly every row of a format is
        a parser that has not learned something yet, not a diver with bad data.
      </p>

      <h2>By format</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Format</th>
              <th className="num">Batches</th>
              <th className="num">Committed</th>
              <th className="num">Failed</th>
              <th className="num">Rows</th>
              <th className="num">Failure rate</th>
            </tr>
          </thead>
          <tbody>
            {[...formats.entries()]
              .sort((a, b) => b[1].batches - a[1].batches)
              .map(([kind, f]) => {
                const rate = f.batches === 0 ? 0 : (f.failed / f.batches) * 100;
                return (
                  <tr key={kind}>
                    <td>
                      <span className="tag">{kind}</span>
                    </td>
                    <td className="num">{f.batches}</td>
                    <td className="num">{f.committed}</td>
                    <td className="num">{f.failed}</td>
                    <td className="num">{f.rows}</td>
                    <td className="num">
                      <span className={`tag ${rate > 20 ? 'bad' : rate > 5 ? 'warn' : 'good'}`}>
                        {rate.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {formats.size === 0 && <p className="empty">No imports yet.</p>}
      </div>

      <h2>Issues, by code</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th className="num">Rows</th>
              <th>Formats</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            {[...issues.entries()]
              .sort((a, b) => b[1].count - a[1].count)
              .map(([code, entry]) => (
                <tr key={code}>
                  <td className="mono">{code}</td>
                  <td className="num">{entry.count}</td>
                  <td>
                    {[...entry.formats].map((f) => (
                      <span key={f} className="tag">
                        {f}
                      </span>
                    ))}
                  </td>
                  <td className="muted">{entry.example}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {issues.size === 0 && <p className="empty">No issues recorded.</p>}
      </div>

      <h2>Normalizations, by field</h2>
      <p className="lede">
        Values the pipeline changed. A low-confidence normalization was <em>not</em> applied — it is
        a correction the engine proposed and declined to make on its own.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th className="num">Rows</th>
              <th className="num">Left for review</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            {[...normalizations.entries()]
              .sort((a, b) => b[1].count - a[1].count)
              .map(([field, entry]) => (
                <tr key={field}>
                  <td className="mono">{field}</td>
                  <td className="num">{entry.count}</td>
                  <td className="num">
                    {entry.low > 0 ? <span className="tag warn">{entry.low}</span> : 0}
                  </td>
                  <td className="muted">{entry.example}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {normalizations.size === 0 && <p className="empty">Nothing has needed correcting.</p>}
      </div>

      <h2>Recent failures</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Format</th>
              <th>Sniffed</th>
              <th>Error</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {failures.map((batch) => (
              <tr key={batch.id}>
                <td>
                  <a href={`/imports/${batch.id}`} className="mono">
                    {shortId(batch.id)}
                  </a>
                </td>
                <td>
                  <span className="tag">{batch.sourceKind}</span>
                </td>
                <td className="muted">{batch.detectedFormat ?? '—'}</td>
                <td className="muted">{batch.error}</td>
                <td className="muted">{dateTime(batch.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {failures.length === 0 && <p className="empty">No failed imports.</p>}
      </div>
    </main>
  );
}

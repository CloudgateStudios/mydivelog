import { db } from '../../lib/db';
import { bytes, dateTime, shortId } from '../../lib/format';
import { StatusTag } from '../page';

export const dynamic = 'force-dynamic';

export default async function Imports() {
  const batches = await db.importBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      userId: true,
      sourceKind: true,
      detectedFormat: true,
      status: true,
      originalFileName: true,
      fileSize: true,
      stats: true,
      error: true,
      createdAt: true,
      committedAt: true,
      revertedAt: true,
      _count: { select: { rows: true, sources: true } },
    },
  });

  return (
    <main>
      <h1>Imports</h1>
      <p className="lede">
        Every batch, newest first. A batch keeps its rows after commit, so an import can be
        inspected long after it ran — and reverted long after that.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Batch</th>
              <th>File</th>
              <th>Format</th>
              <th>Status</th>
              <th className="num">Rows</th>
              <th className="num">Sources</th>
              <th>Outcome</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => {
              const stats = batch.stats as Record<string, number> | null;
              return (
                <tr key={batch.id}>
                  <td>
                    <a href={`/imports/${batch.id}`} className="mono">
                      {shortId(batch.id)}
                    </a>
                    <div className="muted mono" style={{ fontSize: 11 }}>
                      {shortId(batch.userId)}
                    </div>
                  </td>
                  <td>
                    {batch.originalFileName}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {bytes(batch.fileSize)}
                    </div>
                  </td>
                  <td>
                    <span className="tag">{batch.sourceKind}</span>
                    {batch.detectedFormat !== batch.sourceKind && batch.detectedFormat && (
                      // Worth surfacing: it means sniffing and the stored kind
                      // disagreed, which is how a mis-detected file is found.
                      <div className="muted" style={{ fontSize: 11 }}>
                        sniffed {batch.detectedFormat}
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusTag status={batch.status} />
                    {batch.error && (
                      <div className="muted" style={{ fontSize: 11, maxWidth: '22ch' }}>
                        {batch.error}
                      </div>
                    )}
                  </td>
                  <td className="num">{batch._count.rows}</td>
                  <td className="num">{batch._count.sources}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {stats
                      ? `${stats['create'] ?? 0} create · ${stats['merge'] ?? 0} merge · ${stats['review'] ?? 0} review`
                      : '—'}
                  </td>
                  <td className="muted">
                    {dateTime(batch.createdAt)}
                    {batch.committedAt && <div style={{ fontSize: 11 }}>committed</div>}
                    {batch.revertedAt && <div style={{ fontSize: 11 }}>reverted</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {batches.length === 0 && <p className="empty">No imports yet.</p>}
      </div>
    </main>
  );
}

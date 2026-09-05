import { notFound } from 'next/navigation';
import { db, redactProvenanceValue } from '../../../lib/db';
import { bytes, dateTime, metres, minutes, offset, shortId } from '../../../lib/format';
import { StatusTag } from '../../page';

export const dynamic = 'force-dynamic';

/**
 * The import inspector.
 *
 * Any batch, down to the raw source row. This is the debugging surface Phase 3
 * was built to need: when a merge goes wrong, the question is always "what did
 * the file actually say, and why did the engine decide that" — and both
 * answers live here.
 */
export default async function ImportDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const batch = await db.importBatch.findUnique({
    where: { id },
    include: { rows: { orderBy: { rowIndex: 'asc' } } },
  });
  if (!batch) notFound();

  const stats = batch.stats as Record<string, number> | null;

  return (
    <main>
      <h1>
        Import <span className="mono">{shortId(batch.id)}</span> <StatusTag status={batch.status} />
      </h1>
      <p className="lede">
        {batch.originalFileName} · {bytes(batch.fileSize)} · {batch.sourceKind} · user{' '}
        <a href={`/dives?user=${batch.userId}`} className="mono">
          {shortId(batch.userId)}
        </a>
      </p>

      {batch.error && (
        <div className="panel" style={{ padding: '0.7rem', marginBottom: '1rem' }}>
          <span className="tag bad">error</span> {batch.error}
        </div>
      )}

      <div className="cards">
        <Stat k="Parsed" n={stats?.['parsed']} />
        <Stat k="Create" n={stats?.['create']} />
        <Stat k="Merge" n={stats?.['merge']} />
        <Stat k="Review" n={stats?.['review']} />
        <Stat k="Skip" n={stats?.['skip']} />
        <Stat k="Normalized" n={stats?.['normalized']} />
        <Stat k="Issues" n={stats?.['issues']} />
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        Created {dateTime(batch.createdAt)}
        {batch.committedAt ? ` · committed ${dateTime(batch.committedAt)}` : ''}
        {batch.revertedAt ? ` · reverted ${dateTime(batch.revertedAt)}` : ''}
        {' · checksum '}
        <code>{batch.checksum.slice(0, 16)}</code>
      </p>

      <h2>Rows</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Decision</th>
              <th className="num">Score</th>
              <th>Parsed as</th>
              <th>Why</th>
              <th>Changed</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((row) => (
              <Row key={row.rowIndex} row={row} />
            ))}
          </tbody>
        </table>
        {batch.rows.length === 0 && (
          <p className="empty">
            No rows. The file failed before any could be parsed — see the error above.
          </p>
        )}
      </div>
    </main>
  );
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
  raw: unknown;
};

function Row({ row }: { row: StoredRow }) {
  const observation = (row.observation ?? {}) as Record<string, unknown>;
  const reasons = (row.matchReasons ?? []) as { signal: string; detail: string }[];
  const issues = (row.issues ?? []) as { severity: string; code: string; message: string }[];
  const normalizations = (row.normalizations ?? []) as {
    field: string;
    from: unknown;
    to: unknown;
    reason: string;
    confidence: string;
  }[];

  const local = observation['startTimeLocal'];
  const decisionKind =
    row.decision === 'merge'
      ? 'good'
      : row.decision === 'pending'
        ? 'warn'
        : row.decision === 'skip'
          ? 'bad'
          : '';

  return (
    <tr>
      <td className="num mono">{row.rowIndex}</td>
      <td>
        <span className={`tag ${decisionKind}`}>{row.decision}</span>
        {row.decidedBy === 'user' && (
          <div className="muted" style={{ fontSize: 11 }}>
            by hand
          </div>
        )}
        {row.matchDiveId && (
          <div style={{ fontSize: 11 }}>
            <a href={`/dives/${row.matchDiveId}`} className="mono">
              {shortId(row.matchDiveId)}
            </a>
          </div>
        )}
      </td>
      <td className="num">{row.matchScore === null ? '—' : row.matchScore.toFixed(2)}</td>
      <td style={{ minWidth: '15rem' }}>
        <div className="mono" style={{ fontSize: 12 }}>
          {typeof local === 'string'
            ? local
                .replace(/^@date:/, '')
                .replace('T', ' ')
                .slice(0, 19)
            : '—'}{' '}
          <span className="muted">{offset(observation['tzOffsetMinutes'] as number)}</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {metres(observation['maxDepthM'] as number)} ·{' '}
          {minutes(observation['durationS'] as number)}
          {observation['site.name'] ? ` · ${String(observation['site.name'])}` : ''}
          {observation['profile'] ? ' · profile' : ''}
        </div>
        {/* The source's untouched payload. When a parser is wrong, this is the
            only place the truth survives. */}
        <details>
          <summary>raw</summary>
          <pre>{JSON.stringify(row.raw, null, 2)?.slice(0, 4000)}</pre>
        </details>
        <details>
          <summary>parsed fields</summary>
          <pre>
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(observation).map(([k, v]) => [k, redactProvenanceValue(k, v)]),
              ),
              null,
              2,
            )?.slice(0, 4000)}
          </pre>
        </details>
      </td>
      <td style={{ maxWidth: '22rem' }}>
        {reasons.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          reasons.map((r) => (
            <div key={r.signal} style={{ fontSize: 12 }}>
              <span className="tag">{r.signal}</span> <span className="muted">{r.detail}</span>
            </div>
          ))
        )}
      </td>
      <td style={{ maxWidth: '24rem' }}>
        {normalizations.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          normalizations.map((n, i) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
              <span className={`tag ${n.confidence === 'high' ? 'good' : 'warn'}`}>{n.field}</span>{' '}
              <code>{JSON.stringify(n.from)}</code> → <code>{JSON.stringify(n.to)}</code>
              <div className="muted">{n.reason}</div>
            </div>
          ))
        )}
      </td>
      <td style={{ maxWidth: '20rem' }}>
        {issues.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          issues.map((issue, i) => (
            <div key={i} style={{ fontSize: 12 }}>
              <span
                className={`tag ${issue.severity === 'error' ? 'bad' : issue.severity === 'warning' ? 'warn' : ''}`}
              >
                {issue.code}
              </span>{' '}
              <span className="muted">{issue.message}</span>
            </div>
          ))
        )}
      </td>
    </tr>
  );
}

function Stat({ k, n }: { k: string; n: number | undefined }) {
  return (
    <div className="card">
      <div className="n">{n ?? '—'}</div>
      <div className="k">{k}</div>
    </div>
  );
}

import { notFound, redirect } from 'next/navigation';
import { db, redactProvenanceValue } from '../../../lib/db';
import { apiSend, withDone, withError } from '../../../lib/api';
import { Notice, SubmitButton } from '../../../components/StaffForm';
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
export default async function ImportDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { id } = await params;
  const { error, done } = await searchParams;

  const batch = await db.importBatch.findUnique({
    where: { id },
    include: { rows: { orderBy: { rowIndex: 'asc' } } },
  });
  if (!batch) notFound();

  const stats = batch.stats as Record<string, number> | null;
  const here = `/imports/${id}`;

  /**
   * The diver's own undo, triggered on their behalf.
   *
   * Same code path as the button on their review screen, scoped to whoever
   * owns the batch — staff are asking for the diver's action, not performing a
   * different one that happens to look similar.
   */
  async function revert(formData: FormData): Promise<void> {
    'use server';
    const result = await apiSend<{ deleted: string[]; restored: string[] }>(
      `/v1/admin/imports/${id}/revert`,
      { method: 'POST', body: { reason: String(formData.get('reason') ?? '') } },
    );
    if (!result.ok) redirect(withError(here, result.detail));
    redirect(
      withDone(
        here,
        `Reverted. ${result.data.deleted.length} ${
          result.data.deleted.length === 1 ? 'dive' : 'dives'
        } removed, ${result.data.restored.length} restored to what the other sources say.`,
      ),
    );
  }

  return (
    <main>
      <h1>
        Import <span className="mono">{shortId(batch.id)}</span> <StatusTag status={batch.status} />
      </h1>
      <p className="lede">
        {batch.originalFileName} · {bytes(batch.fileSize)} · {batch.sourceKind} · user{' '}
        <a href={`/dives?user=${batch.userId}`} className="mono">
          {shortId(batch.userId)}
        </a>{' '}
        · <a href={`/audit?entityType=import_batch&entityId=${batch.id}`}>staff history</a>
      </p>

      <Notice {...(error ? { error } : {})} {...(done ? { done } : {})} />

      {batch.status === 'committed' && (
        <div className="panel">
          <details>
            <summary>Revert this import</summary>
            <form action={revert} className="stack">
              <p className="hint">
                Removes every source this batch wrote. Dives it created and nothing else touched are
                deleted; dives it merged into are recomputed from the sources that remain, so a dive
                that existed before the import goes back to what those sources say rather than
                disappearing. This can take a minute on a large import.
              </p>
              <label>
                <span>Reason</span>
                <input
                  name="reason"
                  required
                  minLength={3}
                  maxLength={200}
                  placeholder="diver asked by email, ticket 41"
                />
              </label>
              <SubmitButton danger>Revert {batch.originalFileName}</SubmitButton>
            </form>
          </details>
        </div>
      )}

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

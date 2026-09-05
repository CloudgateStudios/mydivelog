import { db } from '../lib/db';
import { dateTime, shortId } from '../lib/format';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const [users, dives, sites, tags, batches, sources, provenance, contested, withProfile] =
    await Promise.all([
      db.user.count(),
      db.dive.count({ where: { deletedAt: null } }),
      db.site.count({ where: { deletedAt: null } }),
      db.tag.count(),
      db.importBatch.count(),
      db.diveSource.count(),
      db.diveFieldProvenance.count(),
      db.dive.count({ where: { deletedAt: null, hasContestedFields: true } }),
      db.dive.count({ where: { deletedAt: null, hasProfile: true } }),
    ]);

  const recent = await db.importBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      sourceKind: true,
      status: true,
      originalFileName: true,
      createdAt: true,
      userId: true,
      _count: { select: { rows: true } },
    },
  });

  // A dive with more than one source is a merge that happened, and it is the
  // most useful number on this page: it says the product did its job.
  //
  // Expressed through Prisma rather than raw SQL. The first attempt wrote
  // `dive_id` — the schema maps table names but not columns, so the column is
  // `diveId`, and a hand-written query is a second place for that to be wrong.
  const merged = await db.dive.count({ where: { deletedAt: null, sources: { some: {} } } });
  const sourceCounts = await db.diveSource.groupBy({ by: ['diveId'], _count: { _all: true } });
  const multiSource = sourceCounts.filter((row) => row._count._all > 1).length;

  return (
    <main>
      <h1>Overview</h1>
      <p className="lede">
        Everything here is read-only. Dive notes are never shown — see the acceptance criteria in{' '}
        <code>docs/11-roadmap.md</code>.
      </p>

      <div className="cards">
        <Card k="Users" n={users} />
        <Card k="Dives" n={dives} />
        <Card k="With profile" n={withProfile} />
        <Card k="Multi-source" n={multiSource} />
        <Card k="Contested" n={contested} />
        <Card k="Sites" n={sites} />
        <Card k="Tags" n={tags} />
      </div>

      <div className="cards">
        <Card k="Import batches" n={batches} />
        <Card k="Dive sources" n={sources} />
        <Card k="Provenance rows" n={provenance} />
        <Card k="Dives with a source" n={merged} />
      </div>

      <h2>Recent imports</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Batch</th>
              <th>File</th>
              <th>Format</th>
              <th>Status</th>
              <th className="num">Rows</th>
              <th>User</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((batch) => (
              <tr key={batch.id}>
                <td>
                  <a href={`/imports/${batch.id}`} className="mono">
                    {shortId(batch.id)}
                  </a>
                </td>
                <td>{batch.originalFileName}</td>
                <td>
                  <span className="tag">{batch.sourceKind}</span>
                </td>
                <td>
                  <StatusTag status={batch.status} />
                </td>
                <td className="num">{batch._count.rows}</td>
                <td className="mono muted">{shortId(batch.userId)}</td>
                <td className="muted">{dateTime(batch.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 && <p className="empty">No imports yet.</p>}
      </div>
    </main>
  );
}

function Card({ k, n }: { k: string; n: number }) {
  return (
    <div className="card">
      <div className="n">{n.toLocaleString()}</div>
      <div className="k">{k}</div>
    </div>
  );
}

export function StatusTag({ status }: { status: string }) {
  const kind =
    status === 'committed'
      ? 'good'
      : status === 'failed'
        ? 'bad'
        : status === 'review'
          ? 'warn'
          : '';
  return <span className={`tag ${kind}`}>{status}</span>;
}

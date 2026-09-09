import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { apiSend, withDone, withError } from '../../lib/api';
import { Notice, SubmitButton } from '../../components/StaffForm';
import { shortId } from '../../lib/format';

export const dynamic = 'force-dynamic';

/**
 * Names divers have proposed for sites in the shared database.
 *
 * A private site is the diver's own record and they rename it themselves. A
 * shared one is everybody's, so a rename becomes a request — and this is where
 * it is answered. Approving renames the site and keeps the old name as an
 * alias so a re-import of an older file still lands here; rejecting keeps the
 * name and emails the diver the reason, which is why the reason is required.
 */
export default async function SiteNames({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { error, done } = await searchParams;

  // Queried here rather than through `createSuggestionRepository(db)`, which
  // would be shorter and would also hand this app a `decide()` that writes.
  // `db.write.test.ts` greps for `db.<model>.<write>(` and would not have seen
  // it — so the shorter version quietly turns the panel back into something
  // that can change data without an audit row.
  const queue = await db.siteNameSuggestion.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: {
      site: { select: { id: true, name: true, latitude: true, longitude: true } },
      user: { select: { id: true, email: true } },
    },
  });

  // How many dives the suggester has logged there: the single most useful
  // thing a moderator can know about a proposed name.
  const counts =
    queue.length === 0
      ? []
      : await db.dive.groupBy({
          by: ['siteId', 'userId'],
          where: {
            deletedAt: null,
            OR: queue.map((row) => ({ siteId: row.siteId, userId: row.userId })),
          },
          _count: { _all: true },
        });
  const diverDives = new Map(counts.map((c) => [`${c.siteId}:${c.userId}`, c._count._all]));

  const decided = await db.siteNameSuggestion.findMany({
    where: { status: { not: 'pending' } },
    orderBy: { decidedAt: 'desc' },
    take: 20,
    include: {
      site: { select: { id: true, name: true } },
      user: { select: { email: true } },
    },
  });

  async function decide(formData: FormData): Promise<void> {
    'use server';
    const id = String(formData.get('id'));
    const outcome = String(formData.get('outcome'));
    const note = String(formData.get('note') ?? '').trim();
    const result = await apiSend<{ notified: boolean }>(
      `/v1/admin/site-name-suggestions/${id}/decide`,
      { method: 'POST', body: { outcome, ...(note === '' ? {} : { note }) } },
    );
    if (!result.ok) redirect(withError('/site-names', result.detail));
    redirect(
      withDone(
        '/site-names',
        outcome === 'approved'
          ? 'Site renamed. The old name is kept as an alias.'
          : result.data.notified
            ? 'Declined, and the diver has been emailed the reason.'
            : // Said rather than swallowed. The decision stands and the diver
              // will read the reason on the site page, but "they have been
              // told" over a message that never sent is how a diver ends up
              // waiting for a reply nobody sent.
              'Declined. The email did not send, so the reason is only on the site page.',
      ),
    );
  }

  const dives = (row: { siteId: string; userId: string }): number =>
    diverDives.get(`${row.siteId}:${row.userId}`) ?? 0;

  return (
    <main>
      <h1>Suggested site names</h1>
      <p className="lede">
        Only shared sites appear here — a diver renames their own sites without asking. Approving
        also answers everyone else waiting on the same site, because their suggestions were made
        against a name that has now moved.
      </p>

      <Notice {...(error ? { error } : {})} {...(done ? { done } : {})} />

      <div className="cards">
        <div className="card">
          <div className="n">{queue.length}</div>
          <div className="k">Waiting</div>
        </div>
      </div>

      <div className="panel">
        {queue.length === 0 ? (
          <p className="empty">Nothing waiting.</p>
        ) : (
          queue.map((row) => (
            <article key={row.id} className="suggestion">
              <h2>
                <a href={`/sites/${row.siteId}`}>{row.site.name}</a> → {row.proposed}
              </h2>
              <p className="muted" style={{ fontSize: 12 }}>
                {/* The single most useful thing here: somebody with forty dives
                    at a site knows what it is called. */}
                {row.user.email} · {dives(row)} {dives(row) === 1 ? 'dive here' : 'dives here'} ·{' '}
                {row.createdAt.toISOString().slice(0, 10)} · {shortId(row.id)}
                {row.site.latitude !== null && row.site.longitude !== null && (
                  <>
                    {' · '}
                    {row.site.latitude.toFixed(4)}, {row.site.longitude.toFixed(4)}
                  </>
                )}
              </p>
              {row.reason && <p className="notes">{row.reason}</p>}

              <div className="actions">
                <form action={decide} className="inline">
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="outcome" value="approved" />
                  <SubmitButton>Rename to {row.proposed}</SubmitButton>
                </form>
                <details>
                  <summary>Decline</summary>
                  <form action={decide} className="stack">
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="outcome" value="rejected" />
                    <label>
                      <span>Why</span>
                      <input name="note" required minLength={3} maxLength={500} />
                    </label>
                    <p className="hint">
                      This is emailed to {row.user.email}. A refusal with no reason reads as the
                      suggestion having been lost.
                    </p>
                    <SubmitButton danger>Keep {row.site.name}</SubmitButton>
                  </form>
                </details>
              </div>
            </article>
          ))
        )}
      </div>

      <h2>Recently decided</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>Proposed</th>
              <th>Outcome</th>
              <th>Reason given</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {decided.map((row) => (
              <tr key={row.id}>
                <td>
                  <a href={`/sites/${row.siteId}`}>{row.site.name}</a>
                </td>
                <td>{row.proposed}</td>
                <td>{row.status}</td>
                <td>{row.decisionNote ?? '—'}</td>
                <td className="mono">{row.decidedAt?.toISOString().slice(0, 10) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {decided.length === 0 && <p className="empty">Nothing decided yet.</p>}
      </div>
    </main>
  );
}

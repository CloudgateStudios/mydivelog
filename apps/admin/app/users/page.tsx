import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { apiSend, withDone, withError } from '../../lib/api';
import { Notice, SubmitButton } from '../../components/StaffForm';
import { dateTime, shortId } from '../../lib/format';

export const dynamic = 'force-dynamic';

/**
 * Accounts, and the two things staff can do to one.
 *
 * Still no dive data and still no way to read anybody's logbook from here.
 * What changed is that suspending an account and closing one are now possible,
 * because a support tool that can only look at an abuse report is not a
 * support tool. Both go through the API, both need a written reason, and both
 * appear in the audit log.
 */
export default async function Users({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { error, done } = await searchParams;

  const users = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      isStaff: true,
      createdAt: true,
      deletedAt: true,
      identities: { select: { provider: true } },
      _count: { select: { dives: true, importBatches: true } },
    },
  });

  async function setStatus(formData: FormData): Promise<void> {
    'use server';
    const id = String(formData.get('id'));
    const status = String(formData.get('status'));
    const result = await apiSend<{ sessionsRevoked: number }>(`/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: { status, reason: String(formData.get('reason') ?? '') },
    });
    if (!result.ok) redirect(withError('/users', result.detail));
    redirect(
      withDone(
        '/users',
        status === 'suspended'
          ? `Suspended, and ${result.data.sessionsRevoked} ${
              result.data.sessionsRevoked === 1 ? 'session' : 'sessions'
            } revoked.`
          : 'Reactivated.',
      ),
    );
  }

  async function remove(formData: FormData): Promise<void> {
    'use server';
    const id = String(formData.get('id'));
    const result = await apiSend<{ dives: number }>(`/v1/admin/users/${id}`, {
      method: 'DELETE',
      body: { reason: String(formData.get('reason') ?? '') },
    });
    if (!result.ok) redirect(withError('/users', result.detail));
    redirect(
      withDone(
        '/users',
        `Account closed. ${result.data.dives} ${
          result.data.dives === 1 ? 'dive is' : 'dives are'
        } kept — closing an account does not erase a logbook.`,
      ),
    );
  }

  return (
    <main>
      <h1>Users</h1>
      <p className="lede">
        Enough to answer a support question, and nothing more: no dive data, and no way to read
        anyone&rsquo;s logbook from here. Suspending and closing an account both go through the API
        and both appear in <a href="/audit">the audit log</a>.
      </p>

      <Notice {...(error ? { error } : {})} {...(done ? { done } : {})} />

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Sign-in</th>
              <th>Status</th>
              <th className="num">Dives</th>
              <th className="num">Imports</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="mono">
                  <a href={`/dives?user=${user.id}`}>{shortId(user.id)}</a>
                  {user.displayName && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {user.displayName}
                    </div>
                  )}
                </td>
                <td className="muted">{user.email}</td>
                <td>
                  {user.identities.map((i) => (
                    <span key={i.provider} className="tag">
                      {i.provider}
                    </span>
                  ))}
                </td>
                <td>
                  <span className={`tag ${user.status === 'active' ? 'good' : 'warn'}`}>
                    {user.status}
                  </span>
                  {user.isStaff && <span className="tag">staff</span>}
                  {user.deletedAt && <span className="tag bad">deleted</span>}
                </td>
                <td className="num">{user._count.dives}</td>
                <td className="num">{user._count.importBatches}</td>
                <td className="muted">{dateTime(user.createdAt)}</td>
                <td className="num">
                  {user.deletedAt ? (
                    <span className="muted">closed</span>
                  ) : (
                    <Actions user={user} setStatus={setStatus} remove={remove} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="empty">No users.</p>}
      </div>
    </main>
  );
}

type Row = {
  id: string;
  email: string;
  status: string;
  isStaff: boolean;
  _count: { dives: number };
};

/**
 * Behind a disclosure, with a reason field inside it.
 *
 * The reason is the confirmation step. A dialog asking "are you sure?" is
 * answered reflexively; typing why you are suspending somebody is not, and it
 * leaves the audit log with a sentence rather than a timestamp.
 */
function Actions({
  user,
  setStatus,
  remove,
}: {
  user: Row;
  setStatus: (formData: FormData) => Promise<void>;
  remove: (formData: FormData) => Promise<void>;
}) {
  const suspended = user.status === 'suspended';

  return (
    <div className="actions">
      <details>
        <summary>{suspended ? 'Reactivate' : 'Suspend'}</summary>
        <form action={setStatus} className="stack">
          <input type="hidden" name="id" value={user.id} />
          <input type="hidden" name="status" value={suspended ? 'active' : 'suspended'} />
          <p className="hint">
            {suspended
              ? 'They will be able to sign in again. Existing sessions were revoked and are not restored, so they sign in fresh.'
              : 'Signs them out everywhere. Suspending revokes every refresh token — without that they stay signed in wherever they already are, for up to a fortnight.'}
          </p>
          <label>
            <span>Reason</span>
            <input name="reason" required minLength={3} maxLength={200} />
          </label>
          <SubmitButton danger={!suspended}>
            {suspended ? 'Reactivate' : 'Suspend'} {user.email}
          </SubmitButton>
        </form>
      </details>

      {!user.isStaff && (
        <details>
          <summary>Close</summary>
          <form action={remove} className="stack">
            <input type="hidden" name="id" value={user.id} />
            <p className="hint">
              Marks the account closed and signs it out everywhere. {user._count.dives}{' '}
              {user._count.dives === 1 ? 'dive is' : 'dives are'} kept — closing an account is not
              erasing a logbook, and erasure is the diver&rsquo;s own request with a grace period
              attached, not a button here.
            </p>
            <label>
              <span>Reason</span>
              <input name="reason" required minLength={3} maxLength={200} />
            </label>
            <SubmitButton danger>Close {user.email}</SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}

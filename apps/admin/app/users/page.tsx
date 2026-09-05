import { db } from '../../lib/db';
import { dateTime, shortId } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default async function Users() {
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

  return (
    <main>
      <h1>Users</h1>
      <p className="lede">
        Enough to answer support questions and nothing more. No dive data, and no way to act on an
        account from here — anything that changes a person&rsquo;s data goes through the API, where
        it is scoped and audited.
      </p>

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
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="empty">No users.</p>}
      </div>
    </main>
  );
}

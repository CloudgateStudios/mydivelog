import { db } from '../../lib/db';
import { shortId } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default async function Tags() {
  const tags = await db.tag.findMany({
    orderBy: [{ isSystem: 'desc' }, { slug: 'asc' }],
    include: { _count: { select: { dives: true } } },
  });

  const system = tags.filter((t) => t.isSystem);
  const user = tags.filter((t) => !t.isSystem);

  return (
    <main>
      <h1>Tags</h1>
      <p className="lede">
        The seeded taxonomy is shared; anything a diver writes that it does not cover becomes their
        own tag. A user tag that many people have written is a candidate for promotion — and an
        empty system list means the seed has not run in this environment.
      </p>

      <div className="cards">
        <div className="card">
          <div className="n">{system.length}</div>
          <div className="k">System</div>
        </div>
        <div className="card">
          <div className="n">{user.length}</div>
          <div className="k">User-created</div>
        </div>
      </div>

      <h2>System taxonomy</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Label</th>
              <th>Category</th>
              <th className="num">Dives</th>
            </tr>
          </thead>
          <tbody>
            {system.map((tag) => (
              <tr key={tag.id}>
                <td className="mono">{tag.slug}</td>
                <td>{tag.label}</td>
                <td className="muted">{tag.category}</td>
                <td className="num">{tag._count.dives}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {system.length === 0 && (
          <p className="empty">
            No system tags. The reference-data seed has not run here — every diver will be minting
            private copies of common tags.
          </p>
        )}
      </div>

      <h2>User-created</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Label</th>
              <th className="num">Dives</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {user.map((tag) => (
              <tr key={tag.id}>
                <td className="mono">{tag.slug}</td>
                <td>{tag.label}</td>
                <td className="num">{tag._count.dives}</td>
                <td className="mono muted">{tag.userId ? shortId(tag.userId) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {user.length === 0 && <p className="empty">None yet.</p>}
      </div>
    </main>
  );
}

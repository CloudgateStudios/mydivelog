import { db } from '../../lib/db';
import { coordinates, dateTime, shortId } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default async function Sites() {
  const sites = await db.site.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { aliases: true, _count: { select: { dives: true } } },
  });

  const named = sites.filter((s) => s.latitude !== null).length;

  return (
    <main>
      <h1>Sites</h1>
      <p className="lede">
        Sites start private to the diver who imported them. A site with a name and no coordinates is
        waiting for a computer export to locate it — and a site with both is what a merge produces
        that neither source could. Open one to rename it, locate it, or fold a duplicate into it.
      </p>

      <div className="cards">
        <div className="card">
          <div className="n">{sites.length}</div>
          <div className="k">Sites</div>
        </div>
        <div className="card">
          <div className="n">{named}</div>
          <div className="k">Located</div>
        </div>
        <div className="card">
          <div className="n">{sites.filter((s) => s.isPublic).length}</div>
          <div className="k">Public</div>
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Coordinates</th>
              <th>Aliases</th>
              <th className="num">Dives</th>
              <th>Owner</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site) => (
              <tr key={site.id} id={site.id}>
                <td>
                  <a href={`/sites/${site.id}`}>{site.name}</a>
                  {site.name === 'Unnamed site' && (
                    // Written by the importer when a computer gave coordinates
                    // and an opaque id instead of a name.
                    <span className="muted" style={{ fontSize: 11 }}>
                      {' '}
                      needs a name
                    </span>
                  )}
                </td>
                <td className="mono">
                  {site.latitude === null ? (
                    <span className="muted">—</span>
                  ) : (
                    coordinates(site.latitude, site.longitude)
                  )}
                </td>
                <td className="muted">
                  {site.aliases.length === 0 ? '—' : site.aliases.map((a) => a.name).join(' · ')}
                </td>
                <td className="num">{site._count.dives}</td>
                <td className="mono muted">
                  {site.ownerUserId ? shortId(site.ownerUserId) : 'system'}
                </td>
                <td className="muted">{dateTime(site.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sites.length === 0 && <p className="empty">No sites yet.</p>}
      </div>
    </main>
  );
}

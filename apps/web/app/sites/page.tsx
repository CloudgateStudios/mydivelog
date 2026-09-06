import { redirect } from 'next/navigation';
import { buildSiteMap, formatCoordinates } from '@mydivelog/domain';
import { apiJson, currentUser } from '../../lib/api';
import { AppHeader } from '../../components/AppHeader';
import { SiteMap } from '../../components/SiteMap';
import { withUnits } from '../../lib/units';

export const dynamic = 'force-dynamic';

type Site = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  regionName: string | null;
  dives: number;
  maxDepthM: number | null;
  firstDive: string | null;
  lastDive: string | null;
};

export default async function Sites() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const u = await withUnits();
  const sites = await apiJson<{ data: Site[] }>('/v1/sites')
    .then((r) => r.data)
    .catch(() => []);

  // Seven of the sample logbook's fifteen sites have no coordinates in any
  // source, so this is the normal case rather than the edge one.
  const located = sites.flatMap((s) =>
    s.latitude === null || s.longitude === null
      ? []
      : [{ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, dives: s.dives }],
  );
  const map = buildSiteMap(located);
  const unlocated = sites.filter((s) => s.latitude === null || s.longitude === null).length;

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <h1>Your sites</h1>

        {sites.length === 0 ? (
          <p className="muted">
            No sites yet. <a href="/import">Import a file</a> and the sites come with it.
          </p>
        ) : (
          <>
            <p className="lede">
              {sites.length} {sites.length === 1 ? 'site' : 'sites'} across {total(sites)} dives.
            </p>

            {map && <SiteMap map={map} unlocated={unlocated} />}

            <h2>Most dived</h2>
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">
                  Your dive sites, most dived first, with coordinates where a source recorded them
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col" className="num">
                      Dives
                    </th>
                    <th scope="col" className="num">
                      Deepest
                    </th>
                    <th scope="col">Last dived</th>
                    <th scope="col">Coordinates</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => (
                    <tr key={site.id}>
                      <th scope="row">
                        <a href={`/sites/${site.id}`}>{site.name}</a>
                        {site.regionName && <span className="muted small"> {site.regionName}</span>}
                      </th>
                      <td className="num">{site.dives}</td>
                      <td className="num">{u.depth(site.maxDepthM)}</td>
                      <td>{site.lastDive?.slice(0, 10) ?? '—'}</td>
                      <td className="mono small">
                        {site.latitude !== null && site.longitude !== null ? (
                          formatCoordinates(site.latitude, site.longitude, 3)
                        ) : (
                          <span className="muted">not recorded</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}

const total = (sites: { dives: number }[]): number => sites.reduce((n, s) => n + s.dives, 0);

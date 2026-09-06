import { notFound, redirect } from 'next/navigation';
import { buildSiteMap, formatCoordinates } from '@mydivelog/domain';
import { ApiError, apiJson, currentUser } from '../../../lib/api';
import { AppHeader } from '../../../components/AppHeader';
import { SiteMap } from '../../../components/SiteMap';
import { withUnits } from '../../../lib/units';

export const dynamic = 'force-dynamic';

type Detail = {
  site: {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    regionName: string | null;
    typicalEntry: string | null;
    description: string | null;
    aliases: string[];
  };
  dives: {
    id: string;
    diveNumber: number;
    startTimeLocal: string;
    maxDepthM: number | null;
    durationS: number | null;
    waterTempMinC: number | null;
    hasProfile: boolean;
  }[];
};

export default async function SiteDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const { id } = await params;
  const u = await withUnits();

  const detail = await apiJson<Detail>(`/v1/sites/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  const { site, dives } = detail;
  const depths = dives.map((d) => d.maxDepthM).filter((d): d is number => d !== null);
  const map =
    site.latitude !== null && site.longitude !== null
      ? buildSiteMap(
          [
            {
              id: site.id,
              name: site.name,
              latitude: site.latitude,
              longitude: site.longitude,
              dives: dives.length,
            },
          ],
          { width: 900, height: 260, padding: 34 },
        )
      : undefined;

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <p className="crumb">
          <a href="/sites">← Sites</a>
        </p>
        <h1>{site.name}</h1>
        <p className="lede">
          {dives.length} {dives.length === 1 ? 'dive' : 'dives'}
          {site.regionName ? ` · ${site.regionName}` : ''}
          {depths.length ? ` · deepest ${u.depth(Math.max(...depths))}` : ''}
        </p>

        {site.aliases.length > 0 && (
          <p className="muted small">
            {/* The merge folded these together. Showing them is how a diver
                confirms "1,000 Steps" and "Thousand Steps" are one place. */}
            Also recorded as {site.aliases.join(', ')}.
          </p>
        )}

        {site.description && <p className="notes">{site.description}</p>}

        {map && <SiteMap map={map} unlocated={0} />}

        <dl className="facts">
          {site.latitude !== null && site.longitude !== null && (
            <div>
              <dt>Coordinates</dt>
              <dd className="mono">{formatCoordinates(site.latitude, site.longitude)}</dd>
            </div>
          )}
          {site.typicalEntry && (
            <div>
              <dt>Entry</dt>
              <dd>{site.typicalEntry}</dd>
            </div>
          )}
        </dl>

        <h2>Your dives here</h2>
        <table>
          <caption className="visually-hidden">
            Your dives at {site.name}, most recent first
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Date</th>
              <th scope="col" className="num">
                Depth
              </th>
              <th scope="col" className="num">
                Duration
              </th>
              <th scope="col" className="num">
                Water
              </th>
            </tr>
          </thead>
          <tbody>
            {dives.map((dive) => (
              <tr key={dive.id}>
                <th scope="row">
                  <a href={`/dives/${dive.id}`}>{dive.diveNumber}</a>
                </th>
                <td>{dive.startTimeLocal.slice(0, 10)}</td>
                <td className="num">{u.depth(dive.maxDepthM)}</td>
                <td className="num">{u.duration(dive.durationS)}</td>
                <td className="num">{u.temperature(dive.waterTempMinC)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}

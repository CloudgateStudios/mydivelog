import 'leaflet/dist/leaflet.css';
import { notFound, redirect } from 'next/navigation';
import { buildSiteMap, formatCoordinates } from '@mydivelog/domain';
import { ApiError, apiFetch, apiJson, currentUser } from '../../../lib/api';
import { SubmitButton } from '../../../components/SubmitButton';
import { AppHeader } from '../../../components/AppHeader';
import { SiteMap } from '../../../components/SiteMap';
import { SiteTileMap } from '../../../components/SiteTileMap';
import { tileSource } from '../../../lib/tiles';
import { withUnits } from '../../../lib/units';

export const dynamic = 'force-dynamic';

type Detail = {
  site: {
    id: string;
    name: string;
    editable: boolean;
    shared: boolean;
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

export default async function SiteDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const { id } = await params;
  const { error, done } = await searchParams;
  const u = await withUnits();

  const detail = await apiJson<Detail>(`/v1/sites/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  const { site, dives } = detail;
  const tiles = tileSource();

  async function save(formData: FormData): Promise<void> {
    'use server';
    const here = `/sites/${id}`;
    const response = await apiFetch(`/v1/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: String(formData.get('name') ?? '').trim(),
        // Cleared together or set together; the contract refuses half a pair,
        // because half a coordinate is not a location.
        latitude: num(formData.get('latitude')),
        longitude: num(formData.get('longitude')),
        typicalEntry: text(formData.get('typicalEntry')),
        description: text(formData.get('description')),
      }),
    });

    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as { detail?: string };
      redirect(`${here}?error=${encodeURIComponent(problem.detail ?? 'That did not save.')}`);
    }
    redirect(`${here}?done=1`);
  }
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

        {error && (
          <p className="notice bad" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="notice" role="status">
            Saved.
          </p>
        )}

        {site.aliases.length > 0 && (
          <p className="muted small">
            {/* The merge folded these together. Showing them is how a diver
                confirms "1,000 Steps" and "Thousand Steps" are one place. */}
            Also recorded as {site.aliases.join(', ')}.
          </p>
        )}

        {site.description && <p className="notes">{site.description}</p>}

        {/* The same map as the sites list, not just the plot underneath it.
            The caption on that plot says the map loads in a moment, and on
            this page it did not — the tile map was wired into the list and
            not here, so the fallback was left telling a diver to wait for
            something that was never coming. */}
        {map && site.latitude !== null && site.longitude !== null && (
          <SiteTileMap
            sites={[
              {
                id: site.id,
                name: site.name,
                latitude: site.latitude,
                longitude: site.longitude,
                dives: dives.length,
              },
            ]}
            tileUrl={tiles.url}
            attribution={tiles.attribution}
            maxZoom={tiles.maxZoom}
          >
            <SiteMap map={map} unlocated={0} />
          </SiteTileMap>
        )}

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

        {site.editable && (
          <details className="site-edit">
            <summary>
              {/* Named for the thing a diver most often comes here to do. A
                  computer that had coordinates and an opaque id leaves the
                  site called `Unnamed site`, and this is the only way to
                  fix that without asking somebody. */}
              {site.name === 'Unnamed site' ? 'Give this site a name' : 'Edit this site'}
            </summary>
            <form action={save} className="stack">
              <label>
                <span>Name</span>
                <input name="name" defaultValue={site.name} required maxLength={160} />
              </label>

              <div className="row">
                <label>
                  <span>Latitude</span>
                  <input
                    name="latitude"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    defaultValue={site.latitude ?? ''}
                  />
                </label>
                <label>
                  <span>Longitude</span>
                  <input
                    name="longitude"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    defaultValue={site.longitude ?? ''}
                  />
                </label>
              </div>
              <p className="muted small">Both or neither — half a coordinate is not a place.</p>

              <label>
                <span>Entry</span>
                <select name="typicalEntry" defaultValue={site.typicalEntry ?? ''}>
                  <option value="">—</option>
                  <option value="shore">shore</option>
                  <option value="boat">boat</option>
                  <option value="dock">dock</option>
                </select>
              </label>

              <label>
                <span>Notes about the site</span>
                <textarea name="description" rows={3} defaultValue={site.description ?? ''} />
              </label>

              <p>
                <SubmitButton className="button primary" pendingLabel="Saving…">
                  Save
                </SubmitButton>
              </p>
              <p className="muted small">
                This site is yours — only you have dived it and only you can see it. Renaming it
                keeps the old name so a future import of an older file still finds this place rather
                than making a second one.
              </p>
            </form>
          </details>
        )}

        {site.shared && (
          <p className="muted small">
            This site is in the shared database, so its name belongs to everyone who dives here.
          </p>
        )}

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

/** An empty number input means "no value", not zero. */
const num = (value: FormDataEntryValue | null): number | null => {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: FormDataEntryValue | null): string | null => {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

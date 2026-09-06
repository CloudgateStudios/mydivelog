import { notFound, redirect } from 'next/navigation';
import { ApiError, apiFetch, apiJson, currentUser } from '../../../lib/api';
import { AppHeader } from '../../../components/AppHeader';
import { withUnits } from '../../../lib/units';

export const dynamic = 'force-dynamic';

type Detail = {
  trip: {
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
    operator: string | null;
    notes: string | null;
  };
  dives: {
    id: string;
    diveNumber: number;
    startTimeLocal: string;
    maxDepthM: number | null;
    durationS: number | null;
    site: { id: string; name: string } | null;
  }[];
};

type Unassigned = {
  id: string;
  diveNumber: number;
  startTimeLocal: string;
  site: { name: string } | null;
};

export default async function TripDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const { id } = await params;
  const u = await withUnits();

  const detail = await apiJson<Detail>(`/v1/trips/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const spare = await apiJson<{ data: Unassigned[] }>('/v1/trips/unassigned')
    .then((r) => r.data)
    .catch(() => []);

  const { trip, dives } = detail;

  async function save(formData: FormData): Promise<void> {
    'use server';
    const value = (name: string): string | null => {
      const raw = formData.get(name);
      return raw === null || raw === '' ? null : String(raw);
    };
    await apiFetch(`/v1/trips/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: value('name') ?? 'Untitled trip',
        startDate: value('startDate'),
        endDate: value('endDate'),
        operator: value('operator'),
        notes: value('notes'),
      }),
    });
    redirect(`/trips/${id}?saved=1`);
  }

  async function addDives(formData: FormData): Promise<void> {
    'use server';
    const diveIds = formData.getAll('diveId').map(String);
    if (diveIds.length > 0) {
      await apiFetch(`/v1/trips/${id}/dives`, {
        method: 'POST',
        body: JSON.stringify({ diveIds }),
      });
    }
    redirect(`/trips/${id}`);
  }

  async function removeDive(formData: FormData): Promise<void> {
    'use server';
    await apiFetch(`/v1/trips/${id}/dives/${String(formData.get('diveId'))}`, {
      method: 'DELETE',
    });
    redirect(`/trips/${id}`);
  }

  async function deleteTrip(): Promise<void> {
    'use server';
    await apiFetch(`/v1/trips/${id}`, { method: 'DELETE' });
    redirect('/trips');
  }

  const depths = dives.map((d) => d.maxDepthM).filter((d): d is number => d !== null);
  const bottomTime = dives.reduce((n, d) => n + (d.durationS ?? 0), 0);

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <p className="crumb">
          <a href="/trips">← Trips</a>
        </p>
        <h1>{trip.name}</h1>
        <p className="lede">
          {dives.length} {dives.length === 1 ? 'dive' : 'dives'}
          {depths.length ? ` · deepest ${u.depth(Math.max(...depths))}` : ''}
          {bottomTime ? ` · ${Math.round(bottomTime / 60)} minutes underwater` : ''}
        </p>

        <h2>Dives on this trip</h2>
        {dives.length === 0 ? (
          <p className="muted">No dives on this trip yet. Add some below.</p>
        ) : (
          <table>
            <caption className="visually-hidden">Dives on {trip.name}, in order</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Date</th>
                <th scope="col">Site</th>
                <th scope="col" className="num">
                  Depth
                </th>
                <th scope="col" className="num">
                  Duration
                </th>
                <th scope="col">
                  <span className="visually-hidden">Remove from trip</span>
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
                  <td>{dive.site?.name ?? <span className="muted">—</span>}</td>
                  <td className="num">{u.depth(dive.maxDepthM)}</td>
                  <td className="num">{u.duration(dive.durationS)}</td>
                  <td>
                    <form action={removeDive} className="inline">
                      <input type="hidden" name="diveId" value={dive.id} />
                      <button
                        className="unbutton"
                        type="submit"
                        aria-label={`Remove dive ${dive.diveNumber} from this trip`}
                      >
                        ×
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {spare.length > 0 && (
          <>
            <h2>Add dives</h2>
            <p className="muted small">
              Dives that are not on any trip. A dive belongs to one trip at a time.
            </p>
            <form action={addDives}>
              <ul className="pick-list">
                {spare.slice(0, 60).map((dive) => (
                  <li key={dive.id}>
                    <label className="chip">
                      <input type="checkbox" name="diveId" value={dive.id} />
                      <span>
                        #{dive.diveNumber} · {dive.startTimeLocal.slice(0, 10)}
                        {dive.site?.name ? ` · ${dive.site.name}` : ''}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p>
                <button className="button" type="submit" style={{ width: 'auto' }}>
                  Add the selected dives
                </button>
              </p>
            </form>
          </>
        )}

        <h2>Details</h2>
        <form action={save} className="stack narrow-form">
          <div className="filter-field">
            <label htmlFor="t-name">Name</label>
            <input id="t-name" name="name" defaultValue={trip.name} required maxLength={120} />
          </div>
          <div className="filter-row">
            <div className="filter-field">
              <label htmlFor="t-start">From</label>
              <input
                id="t-start"
                type="date"
                name="startDate"
                defaultValue={trip.startDate?.slice(0, 10) ?? ''}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="t-end">To</label>
              <input
                id="t-end"
                type="date"
                name="endDate"
                defaultValue={trip.endDate?.slice(0, 10) ?? ''}
              />
            </div>
          </div>
          <div className="filter-field">
            <label htmlFor="t-operator">Operator or boat</label>
            <input
              id="t-operator"
              name="operator"
              defaultValue={trip.operator ?? ''}
              maxLength={160}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="t-notes">Notes</label>
            <textarea id="t-notes" name="notes" rows={4} defaultValue={trip.notes ?? ''} />
          </div>
          <p>
            <button className="button primary" type="submit" style={{ width: 'auto' }}>
              Save
            </button>
          </p>
        </form>

        <h2>Delete this trip</h2>
        <p className="muted small">
          {/* The distinction that matters: deleting a trip must never look like
              deleting the diving. */}
          The dives stay in your logbook. They go back to belonging to no trip.
        </p>
        <form action={deleteTrip}>
          <button className="button" type="submit" style={{ width: 'auto' }}>
            Delete trip
          </button>
        </form>
      </main>
    </>
  );
}

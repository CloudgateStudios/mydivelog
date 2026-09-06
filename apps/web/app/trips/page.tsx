import { redirect } from 'next/navigation';
import { apiFetch, apiJson, currentUser } from '../../lib/api';
import { AppHeader } from '../../components/AppHeader';

export const dynamic = 'force-dynamic';

type Trip = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  operator: string | null;
  dives: number;
};

type Suggestion = {
  key: string;
  name: string;
  from: string;
  to: string;
  diveIds: string[];
};

export default async function Trips() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const [trips, suggestions] = await Promise.all([
    apiJson<{ data: Trip[] }>('/v1/trips')
      .then((r) => r.data)
      .catch(() => []),
    apiJson<{ data: Suggestion[] }>('/v1/trips/suggestions')
      .then((r) => r.data)
      .catch(() => []),
  ]);

  async function create(formData: FormData): Promise<void> {
    'use server';
    const value = (name: string): string | undefined => {
      const raw = formData.get(name);
      return raw === null || raw === '' ? undefined : String(raw);
    };

    const created = await apiJson<{ id: string }>('/v1/trips', {
      method: 'POST',
      body: JSON.stringify({
        name: value('name') ?? 'Untitled trip',
        startDate: value('startDate') ?? null,
        endDate: value('endDate') ?? null,
        operator: value('operator') ?? null,
      }),
    });

    // A suggestion carries the dives it was built from, so accepting one is a
    // create and an assign rather than a create and then a lot of clicking.
    const diveIds = formData.getAll('diveId').map(String);
    if (diveIds.length > 0) {
      await apiFetch(`/v1/trips/${created.id}/dives`, {
        method: 'POST',
        body: JSON.stringify({ diveIds }),
      });
    }
    redirect(`/trips/${created.id}`);
  }

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <h1>Trips</h1>

        {trips.length === 0 && suggestions.length === 0 && (
          <p className="muted">
            No trips yet. Group a run of dives into one and the logbook gains a shape you can
            navigate — <a href="/import">import a file</a> first if this is empty.
          </p>
        )}

        {suggestions.length > 0 && (
          <section className="suggestions">
            <h2>From your logbook</h2>
            <p className="muted small">
              {/* Proposals, never applied on their own: "these dives were one
                  holiday" is a guess about intent, not a fact in the data. */}
              Runs of dives that look like a trip. Nothing is saved until you accept one, and you
              can change the name first.
            </p>
            <ul className="suggestion-list">
              {suggestions.map((suggestion) => (
                <li key={suggestion.key}>
                  <form action={create}>
                    <input type="hidden" name="startDate" value={suggestion.from.slice(0, 10)} />
                    <input type="hidden" name="endDate" value={suggestion.to.slice(0, 10)} />
                    {suggestion.diveIds.map((id) => (
                      <input key={id} type="hidden" name="diveId" value={id} />
                    ))}
                    <label className="visually-hidden" htmlFor={`name-${suggestion.key}`}>
                      Name for this trip
                    </label>
                    <input
                      id={`name-${suggestion.key}`}
                      name="name"
                      defaultValue={suggestion.name}
                      maxLength={120}
                    />
                    <span className="muted small">
                      {suggestion.diveIds.length} dives · {suggestion.from.slice(0, 10)} to{' '}
                      {suggestion.to.slice(0, 10)}
                    </span>
                    <button className="button small" type="submit">
                      Create
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        {trips.length > 0 && (
          <>
            <h2>Your trips</h2>
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Your trips, most recent first</caption>
                <thead>
                  <tr>
                    <th scope="col">Trip</th>
                    <th scope="col">Dates</th>
                    <th scope="col" className="num">
                      Dives
                    </th>
                    <th scope="col">Operator</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr key={trip.id}>
                      <th scope="row">
                        <a href={`/trips/${trip.id}`}>{trip.name}</a>
                      </th>
                      <td>{dates(trip)}</td>
                      <td className="num">{trip.dives}</td>
                      <td>{trip.operator ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h2>Add a trip</h2>
        <form action={create} className="stack narrow-form">
          <div className="filter-field">
            <label htmlFor="new-name">Name</label>
            <input id="new-name" name="name" required maxLength={120} placeholder="Bonaire 2026" />
          </div>
          <div className="filter-row">
            <div className="filter-field">
              <label htmlFor="new-start">From</label>
              <input id="new-start" type="date" name="startDate" />
            </div>
            <div className="filter-field">
              <label htmlFor="new-end">To</label>
              <input id="new-end" type="date" name="endDate" />
            </div>
          </div>
          <div className="filter-field">
            <label htmlFor="new-operator">Operator or boat</label>
            <input id="new-operator" name="operator" maxLength={160} />
          </div>
          <p>
            <button className="button primary" type="submit" style={{ width: 'auto' }}>
              Create trip
            </button>
          </p>
        </form>
      </main>
    </>
  );
}

function dates(trip: Trip): string {
  if (!trip.startDate) return '—';
  const from = trip.startDate.slice(0, 10);
  const to = trip.endDate?.slice(0, 10);
  return !to || to === from ? from : `${from} to ${to}`;
}

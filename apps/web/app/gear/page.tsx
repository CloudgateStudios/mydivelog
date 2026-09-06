import { redirect } from 'next/navigation';
import { GEAR_KINDS } from '@mydivelog/contracts';
import { ApiError, apiFetch, apiJson, currentUser } from '../../lib/api';
import { AppHeader } from '../../components/AppHeader';

export const dynamic = 'force-dynamic';

type Item = {
  id: string;
  kind: string;
  name: string;
  brand: string | null;
  model: string | null;
  serviceDueOn: string | null;
  retiredAt: string | null;
  isRental: boolean;
  dives: number;
};

type Suggestion = { name: string; kind: string; dives: number };

const KIND_LABELS: Record<string, string> = {
  wetsuit: 'Wetsuit',
  drysuit: 'Drysuit',
  bcd: 'BCD',
  regulator: 'Regulator',
  computer: 'Dive computer',
  fins: 'Fins',
  boots: 'Boots',
  hood: 'Hood',
  gloves: 'Gloves',
  light: 'Light',
  camera: 'Camera',
  other: 'Other',
};

export default async function Gear({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const [items, suggestions, { error }] = await Promise.all([
    apiJson<{ data: Item[] }>('/v1/gear')
      .then((r) => r.data)
      .catch(() => []),
    apiJson<{ data: Suggestion[] }>('/v1/gear/suggestions')
      .then((r) => r.data)
      .catch(() => []),
    searchParams,
  ]);

  async function create(formData: FormData): Promise<void> {
    'use server';
    const value = (name: string): string | undefined => {
      const raw = formData.get(name);
      return raw === null || raw === '' ? undefined : String(raw);
    };
    await apiFetch('/v1/gear', {
      method: 'POST',
      body: JSON.stringify({
        kind: value('kind') ?? 'other',
        name: value('name') ?? 'Unnamed',
        brand: value('brand') ?? null,
        model: value('model') ?? null,
        serialNumber: value('serialNumber') ?? null,
        purchasedOn: value('purchasedOn') ?? null,
        serviceDueOn: value('serviceDueOn') ?? null,
        isRental: formData.get('isRental') === 'on',
        // Only from a suggestion: the "Add gear" form below is for kit no
        // import has mentioned, so there is nothing to attach it to.
        linkImportedDives: formData.get('linkImportedDives') === 'true',
      }),
    });
    redirect('/gear');
  }

  async function retire(formData: FormData): Promise<void> {
    'use server';
    await apiFetch(`/v1/gear/${String(formData.get('id'))}`, {
      method: 'PATCH',
      body: JSON.stringify({ retired: formData.get('retired') === 'true' }),
    });
    redirect('/gear');
  }

  async function remove(formData: FormData): Promise<void> {
    'use server';
    try {
      await apiJson(`/v1/gear/${String(formData.get('id'))}`, { method: 'DELETE' });
    } catch (thrown: unknown) {
      // 409 means it has been on dives. The API's message is the useful one —
      // it says what to do instead — so it is shown rather than replaced.
      if (thrown instanceof ApiError && thrown.status === 409) {
        redirect(`/gear?error=${encodeURIComponent(thrown.detail)}`);
      }
      throw thrown;
    }
    redirect('/gear');
  }

  const active = items.filter((i) => i.retiredAt === null);
  const retired = items.filter((i) => i.retiredAt !== null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <h1>Gear</h1>

        {error && <p className="notice bad">{error}</p>}

        {suggestions.length > 0 && (
          <section className="suggestions">
            <h2>From your imports</h2>
            <p className="muted small">
              {/* The spreadsheet's Equipment column is prose. Splitting it on
                  import would be guessing; offering it here is not, because
                  the diver is looking at the list. */}
              Your imported dives mention these. Adding one records it properly, with a service date
              if it needs one.
            </p>
            <ul className="suggestion-list">
              {suggestions.slice(0, 12).map((suggestion) => (
                <li key={suggestion.name}>
                  <form action={create}>
                    <input type="hidden" name="name" value={suggestion.name} />
                    <input type="hidden" name="linkImportedDives" value="true" />
                    {/* Name first: it is what the diver is deciding about. The
                        kind is a pre-filled guess they only touch if it is
                        wrong. */}
                    <span className="grow">
                      {suggestion.name}
                      <span className="muted small"> on {suggestion.dives} dives</span>
                    </span>
                    <label className="visually-hidden" htmlFor={`kind-${suggestion.name}`}>
                      What kind of gear is {suggestion.name}?
                    </label>
                    <select
                      id={`kind-${suggestion.name}`}
                      name="kind"
                      defaultValue={suggestion.kind}
                    >
                      {GEAR_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_LABELS[kind] ?? kind}
                        </option>
                      ))}
                    </select>
                    <button className="button small" type="submit">
                      Add
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        <h2>Your kit</h2>
        {active.length === 0 ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <GearTable items={active} today={today} retire={retire} remove={remove} retired={false} />
        )}

        {retired.length > 0 && (
          <>
            <h2>Retired</h2>
            <p className="muted small">
              Kept, because it was on dives that happened. Removing it would rewrite them.
            </p>
            <GearTable
              items={retired}
              today={today}
              retire={retire}
              remove={remove}
              retired={true}
            />
          </>
        )}

        <h2>Add gear</h2>
        <form action={create} className="stack narrow-form">
          <div className="filter-row">
            <div className="filter-field grow">
              <label htmlFor="g-name">Name</label>
              <input id="g-name" name="name" required maxLength={120} />
            </div>
            <div className="filter-field">
              <label htmlFor="g-kind">Kind</label>
              <select id="g-kind" name="kind" defaultValue="other">
                {GEAR_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind] ?? kind}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="filter-row">
            <div className="filter-field">
              <label htmlFor="g-brand">Brand</label>
              <input id="g-brand" name="brand" maxLength={80} />
            </div>
            <div className="filter-field">
              <label htmlFor="g-model">Model</label>
              <input id="g-model" name="model" maxLength={80} />
            </div>
            <div className="filter-field">
              <label htmlFor="g-serial">Serial number</label>
              <input id="g-serial" name="serialNumber" maxLength={80} />
            </div>
          </div>
          <div className="filter-row">
            <div className="filter-field">
              <label htmlFor="g-purchased">Bought on</label>
              <input id="g-purchased" type="date" name="purchasedOn" />
            </div>
            <div className="filter-field">
              <label htmlFor="g-service">Service due</label>
              <input id="g-service" type="date" name="serviceDueOn" />
            </div>
            <label className="chip">
              <input type="checkbox" name="isRental" />
              <span>Rental</span>
            </label>
          </div>
          <p>
            <button className="button primary" type="submit" style={{ width: 'auto' }}>
              Add gear
            </button>
          </p>
        </form>
      </main>
    </>
  );
}

function GearTable({
  items,
  today,
  retire,
  remove,
  retired,
}: {
  items: Item[];
  today: string;
  retire: (formData: FormData) => Promise<void>;
  remove: (formData: FormData) => Promise<void>;
  retired: boolean;
}) {
  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">
          {retired ? 'Retired gear' : 'Gear you are using'}
        </caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Kind</th>
            <th scope="col" className="num">
              Dives
            </th>
            <th scope="col">Service due</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const overdue = item.serviceDueOn !== null && item.serviceDueOn.slice(0, 10) < today;
            return (
              <tr key={item.id}>
                <th scope="row">
                  {item.name}
                  {(item.brand ?? item.model) && (
                    <span className="muted small">
                      {' '}
                      {[item.brand, item.model].filter(Boolean).join(' ')}
                    </span>
                  )}
                  {item.isRental && <span className="muted small"> rental</span>}
                </th>
                <td>{KIND_LABELS[item.kind] ?? item.kind}</td>
                <td className="num">{item.dives}</td>
                <td>
                  {item.serviceDueOn ? (
                    <>
                      {item.serviceDueOn.slice(0, 10)}
                      {/* Named in words as well as coloured — a red date is
                          invisible to a reader who cannot see red. */}
                      {overdue && <span className="status no overdue"> overdue</span>}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="row-actions">
                  <form action={retire} className="inline">
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="retired" value={retired ? 'false' : 'true'} />
                    <button className="button small" type="submit">
                      {retired ? 'Bring back' : 'Retire'}
                    </button>
                  </form>
                  {item.dives === 0 && (
                    <form action={remove} className="inline">
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        className="unbutton"
                        type="submit"
                        aria-label={`Delete ${item.name}`}
                        title={`Delete ${item.name}`}
                      >
                        ×
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

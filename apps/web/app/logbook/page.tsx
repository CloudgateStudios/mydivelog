import { redirect } from 'next/navigation';
import { apiFetch, apiJson, currentUser } from '../../lib/api';
import { AppHeader } from '../../components/AppHeader';
import { FilterBar } from '../../components/FilterBar';
import { SavedViews } from '../../components/SavedViews';
import { withUnits } from '../../lib/units';
import { describe, isFiltered, readFilters, toQuery } from '../../lib/filters';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type Dive = {
  id: string;
  diveNumber: number;
  startTimeLocal: string;
  maxDepthM: number | null;
  durationS: number | null;
  hasProfile: boolean;
  site: { name: string } | null;
};

type Facets = {
  sites: { id: string; name: string; count: number }[];
  tags: { slug: string; name: string; count: number }[];
};

type Page = { data: Dive[]; nextCursor: string | null; total?: number };

const EMPTY_FACETS: Facets = { sites: [], tags: [] };

export default async function Logbook({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const filters = readFilters(await searchParams);
  const query = toQuery(filters, { withTotal: 'true', limit: String(PAGE_SIZE) });

  const u = await withUnits();
  // Three requests that do not depend on each other. Sequentially they are
  // three round trips before anything renders.
  const [page, facets, views] = await Promise.all([
    apiJson<Page>(`/v1/dives?${query}`).catch(() => ({ data: [], nextCursor: null }) as Page),
    apiJson<Facets>('/v1/dives/facets').catch(() => EMPTY_FACETS),
    apiJson<{ data: { id: string; name: string; query: string }[] }>('/v1/saved-views')
      .then((r) => r.data)
      .catch(() => []),
  ]);

  // What the saved view stores, and what the "on" state compares against: the
  // filters, without the page the diver happens to be on.
  const { cursor: _cursor, ...withoutPaging } = filters;
  const current = toQuery(withoutPaging);
  const sentence = describe(filters, u.prefs, facets);

  async function save(formData: FormData): Promise<void> {
    'use server';
    await apiFetch('/v1/saved-views', {
      method: 'POST',
      body: JSON.stringify({
        name: String(formData.get('name') ?? '').slice(0, 60),
        query: String(formData.get('query') ?? ''),
      }),
    });
    redirect(`/logbook?${String(formData.get('query') ?? '')}`);
  }

  async function remove(formData: FormData): Promise<void> {
    'use server';
    await apiFetch(`/v1/saved-views/${String(formData.get('id'))}`, { method: 'DELETE' });
    redirect('/logbook');
  }

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <h1>Your logbook</h1>

        <SavedViews
          views={views}
          current={current}
          suggestedName={sentence ? capitalise(sentence) : ''}
          save={save}
          remove={remove}
        />

        <FilterBar filters={filters} facets={facets} prefs={u.prefs} />

        {/*
          No aria-live. Every navigation here is a full page load — the filter
          bar is a native GET form and the view chips are plain anchors — so a
          live region would never fire, and the screen reader announces the new
          document anyway. An attribute that describes behaviour the page does
          not have is worse than none: it reads as covered.
        */}
        <p className="result-count">
          <Count total={page.total} shown={page.data.length} sentence={sentence} />
        </p>

        {page.data.length === 0 ? (
          <Empty filtered={isFiltered(filters)} />
        ) : (
          <>
            {/* Six columns is one more than a phone has room for, so the
                scroll stays inside the table rather than taking the page
                sideways with it. */}
            <div className="table-scroll">
              <table className="log-table">
                <caption className="visually-hidden">
                  Your dives{sentence ? `, ${sentence}` : ''}
                </caption>
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
                    <th scope="col">Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.map((dive) => (
                    <tr key={dive.id}>
                      <th scope="row">
                        <a href={`/dives/${dive.id}`}>{dive.diveNumber}</a>
                      </th>
                      <td>{dive.startTimeLocal.slice(0, 10)}</td>
                      <td>{dive.site?.name ?? <span className="muted">—</span>}</td>
                      <td className="num">{u.depth(dive.maxDepthM)}</td>
                      <td className="num">{u.duration(dive.durationS)}</td>
                      <td>
                        {/* The tick is decoration; the text is what a screen
                          reader reads, so the column is not a row of "check". */}
                        {dive.hasProfile ? (
                          <>
                            <span aria-hidden="true">✓</span>
                            <span className="visually-hidden">Has a depth profile</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true" className="muted">
                              —
                            </span>
                            <span className="visually-hidden">No depth profile</span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {page.nextCursor && (
              <p className="pager">
                <a
                  className="button"
                  href={`/logbook?${toQuery(withoutPaging, { cursor: page.nextCursor })}`}
                >
                  Older dives
                </a>
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Count({
  total,
  shown,
  sentence,
}: {
  total: number | undefined;
  shown: number;
  sentence: string;
}) {
  // `total` is what the filter matched; `shown` is what fits on this page.
  // Conflating them is how a paged list ends up telling a diver they have 50
  // dives when they have 400.
  const count = total ?? shown;
  const noun = count === 1 ? 'dive' : 'dives';
  return (
    <>
      <strong>
        {count} {noun}
      </strong>
      {sentence ? ` ${sentence}` : ''}
      {total !== undefined && shown < total ? ` — showing ${shown}` : ''}
    </>
  );
}

function Empty({ filtered }: { filtered: boolean }) {
  return filtered ? (
    <p className="muted">
      No dives match. <a href="/logbook">Clear the filters</a> to see everything.
    </p>
  ) : (
    <p className="muted">
      No dives yet. Importing is how most people start — a spreadsheet or a dive computer export,
      and the merge takes it from there.
    </p>
  );
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

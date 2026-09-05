import type { UnitPreferences } from '@mydivelog/domain';
import { SORTS, edgesIncluding, type LogFilters } from '../lib/filters';

type Facets = {
  sites: { id: string; name: string; count: number }[];
  tags: { slug: string; name: string; count: number }[];
};

/**
 * A plain GET form.
 *
 * No client JavaScript: the browser builds the query string, the URL becomes
 * the filter state, and back, reload, bookmark and share all work without
 * anyone implementing them. It also means the log filters on a phone with a
 * dying connection, which is roughly where a dive logbook gets used.
 *
 * The depth control is a select of bands rather than two number inputs — see
 * lib/filters — and the whole thing submits from one button rather than
 * re-navigating on every change, so a diver can set three filters before
 * anything moves under them.
 */
export function FilterBar({
  filters,
  facets,
  prefs,
}: {
  filters: LogFilters;
  facets: Facets;
  prefs: UnitPreferences;
}) {
  return (
    <form
      className="filters"
      method="get"
      action="/logbook"
      role="search"
      aria-label="Filter dives"
    >
      <div className="filter-row">
        <div className="filter-field grow">
          <label htmlFor="f-q">Search</label>
          <input
            id="f-q"
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="A site, a buddy, something you wrote down"
          />
        </div>

        {facets.sites.length > 0 && (
          <div className="filter-field">
            <label htmlFor="f-site">Site</label>
            <select id="f-site" name="siteId" defaultValue={filters.siteId ?? ''}>
              <option value="">Anywhere</option>
              {facets.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.count})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="filter-field">
          <label htmlFor="f-min">Deeper than</label>
          <select id="f-min" name="minDepthM" defaultValue={filters.minDepthM ?? ''}>
            <option value="">Any depth</option>
            {edgesIncluding(filters.minDepthM, prefs).map((edge) => (
              <option key={edge.metres} value={edge.metres}>
                {edge.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="f-max">Shallower than</label>
          <select id="f-max" name="maxDepthM" defaultValue={filters.maxDepthM ?? ''}>
            <option value="">Any depth</option>
            {edgesIncluding(filters.maxDepthM, prefs).map((edge) => (
              <option key={edge.metres} value={edge.metres}>
                {edge.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="f-sort">Order</label>
          <select id="f-sort" name="sort" defaultValue={filters.sort}>
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="filter-row">
        <div className="filter-field">
          <label htmlFor="f-from">From</label>
          <input id="f-from" type="date" name="from" defaultValue={filters.from ?? ''} />
        </div>
        <div className="filter-field">
          <label htmlFor="f-to">To</label>
          <input id="f-to" type="date" name="to" defaultValue={filters.to ?? ''} />
        </div>

        {facets.tags.length > 0 && (
          <fieldset className="filter-tags">
            <legend>Tags</legend>
            {facets.tags.map((tag) => (
              <label key={tag.slug} className="chip">
                <input
                  type="checkbox"
                  name="tag"
                  value={tag.slug}
                  defaultChecked={filters.tag.includes(tag.slug)}
                />
                <span>
                  {tag.name} <span className="muted">{tag.count}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <label className="chip">
          <input
            type="checkbox"
            name="hasProfile"
            value="true"
            defaultChecked={filters.hasProfile === 'true'}
          />
          <span>Has a depth profile</span>
        </label>
      </div>

      <div className="filter-actions">
        <button className="button primary" type="submit">
          Apply
        </button>
        <a className="button" href="/logbook">
          Clear
        </a>
      </div>
    </form>
  );
}

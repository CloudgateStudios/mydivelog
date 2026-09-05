import type { UnitPreferences } from '@mydivelog/domain';
import { units } from '@mydivelog/domain';

/**
 * The log's filter state, which lives in the URL.
 *
 * The URL is the state because that is what makes a filtered log a thing you
 * can bookmark, share, reload and go back from — all of which a diver expects
 * from a list of their own dives and none of which happens for free if the
 * filters live in component state.
 *
 * Every value here is exactly what the API takes, metres included. Converting
 * at the edge and carrying SI in between is the same rule the rest of the
 * codebase follows, and it means a saved view means one range rather than
 * whatever the person opening it happens to have set in their preferences.
 */
export type LogFilters = {
  q?: string;
  siteId?: string;
  tag: string[];
  from?: string;
  to?: string;
  minDepthM?: string;
  maxDepthM?: string;
  hasProfile?: string;
  sort: string;
  cursor?: string;
};

export const SORTS: [string, string][] = [
  ['date_desc', 'Newest first'],
  ['date_asc', 'Oldest first'],
  ['depth_desc', 'Deepest first'],
  ['duration_desc', 'Longest first'],
  ['number_asc', 'By dive number'],
];

/**
 * Depth edges, not a pair of number boxes.
 *
 * Typing a bound requires already knowing your own numbers; picking one does
 * not. These are the certification limits divers are taught in — 18 m is where
 * Open Water stops, 30 m where Advanced does, 40 m the recreational limit — so
 * they name something a diver already thinks in.
 *
 * Two selects rather than one band picker, because each emits the parameter
 * the API takes directly. A single "18–30 m" control would have to invent a
 * band name for the URL, and a band name means different depths to a diver who
 * logs in feet — which is exactly the ambiguity carrying metres avoids. It also
 * lets a diver ask for "deeper than 30 m" with no upper bound at all.
 *
 * The metric and imperial edges are deliberately *different* filters: 60 ft is
 * 18.288 m, and rounding one to match the other would quietly change what the
 * diver asked for.
 */
export type DepthEdge = { metres: number; label: string };

const METRIC_EDGES: DepthEdge[] = [
  { metres: 12, label: '12 m' },
  { metres: 18, label: '18 m' },
  { metres: 30, label: '30 m' },
  { metres: 40, label: '40 m' },
];

const IMPERIAL_EDGES: DepthEdge[] = [
  { metres: 12.192, label: '40 ft' },
  { metres: 18.288, label: '60 ft' },
  { metres: 30.48, label: '100 ft' },
  { metres: 39.624, label: '130 ft' },
];

export const depthEdges = (prefs: UnitPreferences): DepthEdge[] =>
  (prefs.depthUnit ? prefs.depthUnit === 'ft' : prefs.unitSystem === 'imperial')
    ? IMPERIAL_EDGES
    : METRIC_EDGES;

/**
 * The edges to offer, including one the diver already has that is not on the
 * list — from a saved view, a switch of units, or a hand-edited URL.
 *
 * Without this the select would fall back to its first option, and pressing
 * Apply would silently replace a filter the diver never changed.
 */
export function edgesIncluding(current: string | undefined, prefs: UnitPreferences): DepthEdge[] {
  const edges = depthEdges(prefs);
  if (!current || edges.some((e) => String(e.metres) === current)) return edges;

  const metres = Number(current);
  if (!Number.isFinite(metres)) return edges;
  return [...edges, { metres, label: units.depth(metres, prefs).text }].sort(
    (a, b) => a.metres - b.metres,
  );
}

/**
 * Filters as the query string both the API and a saved view take.
 *
 * `extra` is for the parameters that are not filters — paging, and asking for
 * a total. They are kept out of LogFilters so that a saved view, which is
 * built from the filters alone, cannot accidentally carry one.
 */
export function toQuery(filters: Partial<LogFilters>, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value === undefined || value === '' || value === null) continue;
    // Repeated values are sorted as well as the keys, because the API sorts
    // them when it stores a saved view. Without this, the string this page
    // builds and the string the API hands back differ by tag order alone —
    // and the view a diver is looking at never matches the view they saved, so
    // its chip never highlights and it offers to save it again.
    if (Array.isArray(value)) for (const v of [...value].sort()) params.append(key, v);
    else params.set(key, String(value));
  }
  params.sort();
  return params.toString();
}

/** Whether anything is actually narrowing the log. Sort alone is not a filter. */
export const isFiltered = (filters: LogFilters): boolean =>
  Boolean(
    filters.q ||
    filters.siteId ||
    filters.tag.length ||
    filters.from ||
    filters.to ||
    filters.minDepthM ||
    filters.maxDepthM ||
    filters.hasProfile,
  );

/** Next.js hands a repeated query param as an array and a single one as a string. */
const many = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export function readFilters(params: Record<string, string | string[] | undefined>): LogFilters {
  return {
    ...(one(params['q']) ? { q: one(params['q']) as string } : {}),
    ...(one(params['siteId']) ? { siteId: one(params['siteId']) as string } : {}),
    tag: many(params['tag']),
    ...(one(params['from']) ? { from: one(params['from']) as string } : {}),
    ...(one(params['to']) ? { to: one(params['to']) as string } : {}),
    ...(one(params['minDepthM']) ? { minDepthM: one(params['minDepthM']) as string } : {}),
    ...(one(params['maxDepthM']) ? { maxDepthM: one(params['maxDepthM']) as string } : {}),
    ...(one(params['hasProfile']) ? { hasProfile: one(params['hasProfile']) as string } : {}),
    sort: one(params['sort']) ?? 'date_desc',
    ...(one(params['cursor']) ? { cursor: one(params['cursor']) as string } : {}),
  };
}

/**
 * A filter set in a sentence.
 *
 * "3 dives" answers nothing on its own; "3 dives at Hilma Hooker, past 30 m"
 * tells a diver whether the number is surprising, which is the only reason to
 * show a count. It doubles as the suggested name when they save the view.
 */
export function describe(
  filters: LogFilters,
  prefs: UnitPreferences,
  facets: { sites: { id: string; name: string }[]; tags: { slug: string; name: string }[] },
): string {
  const parts: string[] = [];
  if (filters.q) parts.push(`matching “${filters.q}”`);

  const site = facets.sites.find((s) => s.id === filters.siteId);
  if (site) parts.push(`at ${site.name}`);

  const tagNames = filters.tag
    .map((slug) => facets.tags.find((t) => t.slug === slug)?.name ?? slug)
    .join(' and ');
  if (tagNames) parts.push(tagNames.toLowerCase());

  const label = (m?: string) => (m ? units.depth(Number(m), prefs).text : undefined);
  const min = label(filters.minDepthM);
  const max = label(filters.maxDepthM);
  if (min && max) parts.push(`${min} to ${max}`);
  else if (min) parts.push(`deeper than ${min}`);
  else if (max) parts.push(`shallower than ${max}`);

  if (filters.from && filters.to) parts.push(`between ${filters.from} and ${filters.to}`);
  else if (filters.from) parts.push(`since ${filters.from}`);
  else if (filters.to) parts.push(`up to ${filters.to}`);

  if (filters.hasProfile) parts.push('with a depth profile');

  return parts.join(', ');
}

import { describe, expect, it } from 'vitest';
import type { UnitPreferences } from '@mydivelog/domain';
import {
  describe as sentenceFor,
  edgesIncluding,
  isFiltered,
  readFilters,
  toQuery,
} from './filters';

const metric: UnitPreferences = { unitSystem: 'metric' };
const imperial: UnitPreferences = { unitSystem: 'imperial' };

const facets = {
  sites: [{ id: 'site-1', name: 'Hilma Hooker' }],
  tags: [
    { slug: 'wreck', name: 'Wreck' },
    { slug: 'night', name: 'Night' },
  ],
};

describe('reading filters out of a URL', () => {
  it('takes a repeated tag as several tags', () => {
    expect(readFilters({ tag: ['wreck', 'night'] }).tag).toEqual(['wreck', 'night']);
    expect(readFilters({ tag: 'wreck' }).tag).toEqual(['wreck']);
    expect(readFilters({}).tag).toEqual([]);
  });

  it('defaults the order rather than leaving it undefined', () => {
    expect(readFilters({}).sort).toBe('date_desc');
  });

  it('does not count an order as a filter', () => {
    // Otherwise the empty log says "no dives match" and offers to clear
    // filters that were never set.
    expect(isFiltered(readFilters({ sort: 'depth_desc' }))).toBe(false);
    expect(isFiltered(readFilters({ q: 'manta' }))).toBe(true);
  });
});

describe('building a query', () => {
  it('sorts keys and repeated values, so one filter set is one string', () => {
    // The API sorts the same way when it stores a saved view. If these two
    // disagreed, the view a diver is looking at would never match the one they
    // saved: its chip would not highlight and it would offer to save it again.
    expect(toQuery({ tag: ['wreck', 'night'], sort: 'date_desc' })).toBe(
      toQuery({ sort: 'date_desc', tag: ['night', 'wreck'] }),
    );
  });

  it('drops empty values rather than sending them', () => {
    expect(toQuery({ q: '', sort: 'date_desc' })).toBe('sort=date_desc');
  });

  it('keeps paging out of the filters it is given', () => {
    expect(toQuery({ sort: 'date_desc' }, { cursor: 'abc' })).toContain('cursor=abc');
  });
});

describe('depth edges', () => {
  it('offers the limits a diver was certified against', () => {
    expect(edgesIncluding(undefined, metric).map((e) => e.label)).toEqual([
      '12 m',
      '18 m',
      '30 m',
      '40 m',
    ]);
    expect(edgesIncluding(undefined, imperial).map((e) => e.label)).toEqual([
      '40 ft',
      '60 ft',
      '100 ft',
      '130 ft',
    ]);
  });

  it('keeps a bound that is not on the list', () => {
    // The cross-unit case: an imperial diver saves "deeper than 100 ft", which
    // is 30.48 m. Opening that view in metric must still show the filter that
    // is applied -- without this the select falls back to its first option and
    // pressing Apply silently changes a filter nobody touched.
    const edges = edgesIncluding('30.48', metric);
    expect(edges.map((e) => e.label)).toContain('30.5 m');
    expect(edges.map((e) => e.metres)).toEqual([12, 18, 30, 30.48, 40]);
  });

  it('ignores a bound that is not a number', () => {
    expect(edgesIncluding('nonsense', metric)).toHaveLength(4);
  });
});

describe('saying what a filter set means', () => {
  const of = (params: Record<string, string | string[]>, prefs = metric) =>
    sentenceFor(readFilters(params), prefs, facets);

  it('names sites and tags rather than their ids', () => {
    expect(of({ siteId: 'site-1', tag: ['wreck'] })).toBe('at Hilma Hooker, wreck');
  });

  it('reads a depth bound in the diver’s own units', () => {
    expect(of({ minDepthM: '30.48' })).toBe('deeper than 30.5 m');
    expect(of({ minDepthM: '30.48' }, imperial)).toBe('deeper than 100 ft');
  });

  it('says nothing when nothing is filtered', () => {
    // The count reads "24 dives" and not "24 dives ".
    expect(of({ sort: 'depth_desc' })).toBe('');
  });

  it('falls back to a slug it has no label for', () => {
    // A tag can disappear from the facets -- the last dive carrying it was
    // deleted -- while a saved view still names it.
    expect(of({ tag: ['gone'] })).toBe('gone');
  });
});

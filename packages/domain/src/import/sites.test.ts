import { describe, expect, it } from 'vitest';
import { matchSite, siteCoordinateUpdate, type ExistingSite } from './sites.ts';

const angelCity: ExistingSite = { id: 'angel', name: 'Angel City', lat: 12.1, lon: -68.29 };
const saltPier: ExistingSite = { id: 'salt', name: 'Salt Pier', lat: 12.105, lon: -68.29 };
const unlocated: ExistingSite = { id: 'thousand', name: '1,000 Steps' };

describe('matchSite', () => {
  it('matches a site 20 m away on coordinates alone', () => {
    // Every dive in the seed UDDF created a fresh site record, so the same
    // reef appears 96 times with slightly different fixes.
    const m = matchSite({ lat: 12.10018, lon: -68.29 }, [angelCity]);
    expect(m?.siteId).toBe('angel');
    expect(m?.rule).toBe('coordinates');
  });

  it('does not match a different mooring 550 m away', () => {
    expect(matchSite({ lat: 12.105, lon: -68.29 }, [angelCity])).toBeUndefined();
  });

  it('needs the name to agree at reef scale', () => {
    // 200 m apart is the same reef or a different site depending on what the
    // diver calls it, and only they know.
    const nearby = { lat: 12.1018, lon: -68.29 };
    expect(matchSite(nearby, [angelCity])).toBeUndefined();
    expect(matchSite({ ...nearby, name: 'Angel City' }, [angelCity])?.rule).toBe(
      'coordinates-and-name',
    );
  });

  it('picks the nearest when several are close', () => {
    const m = matchSite({ lat: 12.1001, lon: -68.29 }, [saltPier, angelCity]);
    expect(m?.siteId).toBe('angel');
  });

  it('matches a named site with no coordinates', () => {
    // The spreadsheet side: a name and nothing else.
    expect(matchSite({ name: 'Angel City' }, [angelCity])?.rule).toBe('name');
  });

  it('matches the written variants of one site', () => {
    // `1,000 Steps` and `1000 Steps` slugify to `1-000-steps` and
    // `1000-steps`, so slug equality misses the pair this rule exists for.
    expect(matchSite({ name: '1000 Steps' }, [unlocated])?.siteId).toBe('thousand');
    expect(matchSite({ name: '1,000 steps' }, [unlocated])?.siteId).toBe('thousand');
  });

  it('does not match two genuinely different sites by name', () => {
    expect(matchSite({ name: 'Salt Pier' }, [unlocated])).toBeUndefined();
    expect(matchSite({ name: 'Angel City' }, [saltPier])).toBeUndefined();
  });

  it('matches through an alias', () => {
    const m = matchSite({ name: 'Thousand Steps' }, [
      { ...unlocated, aliases: ['Thousand Steps'] },
    ]);
    expect(m?.rule).toBe('alias');
  });

  it('ignores null island', () => {
    // A writer filling missing coordinates with zeroes would otherwise cluster
    // every unlocated dive in a file into one imaginary site.
    expect(matchSite({ lat: 0, lon: 0 }, [{ id: 'x', name: 'X', lat: 0, lon: 0 }])).toBeUndefined();
  });

  it('returns nothing for an observation with neither name nor coordinates', () => {
    expect(matchSite({}, [angelCity])).toBeUndefined();
  });

  it('returns nothing when there are no candidates', () => {
    expect(matchSite({ name: 'Angel City' }, [])).toBeUndefined();
  });

  it('explains itself', () => {
    expect(matchSite({ lat: 12.10018, lon: -68.29 }, [angelCity])?.detail).toContain('Angel City');
  });
});

describe('siteCoordinateUpdate', () => {
  it('gives coordinates to a site that has none', () => {
    // The spreadsheet named it; the watch knows where it is. This is the
    // moment a site becomes both.
    expect(siteCoordinateUpdate({}, { lat: 12.1, lon: -68.29 })).toEqual({
      lat: 12.1,
      lon: -68.29,
    });
  });

  it('leaves an already-located site alone', () => {
    expect(
      siteCoordinateUpdate({ lat: 12.1, lon: -68.29 }, { lat: 12.2, lon: -68.3 }),
    ).toBeUndefined();
  });

  it('refuses null island', () => {
    expect(siteCoordinateUpdate({}, { lat: 0, lon: 0 })).toBeUndefined();
  });

  it('does nothing when there is nothing to add', () => {
    expect(siteCoordinateUpdate({}, {})).toBeUndefined();
  });
});

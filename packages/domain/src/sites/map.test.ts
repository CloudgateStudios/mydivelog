import { describe, expect, it } from 'vitest';
import { buildSiteMap, formatCoordinates, type MappableSite } from './map.ts';

const site = (id: string, latitude: number, longitude: number, dives = 1): MappableSite => ({
  id,
  name: id,
  latitude,
  longitude,
  dives,
});

const box = { width: 900, height: 460, padding: 34 };

describe('buildSiteMap', () => {
  it('puts north above south and east right of west', () => {
    // The one thing a locator plot must not get wrong.
    const map = buildSiteMap([site('north', 12.2, -68.3), site('south', 12.0, -68.2)], box);
    const north = map?.sites.find((s) => s.id === 'north');
    const south = map?.sites.find((s) => s.id === 'south');

    expect(north?.y).toBeLessThan(south?.y as number);
    expect(south?.x).toBeGreaterThan(north?.x as number);
  });

  it('keeps every marker inside the box', () => {
    const map = buildSiteMap(
      [site('a', 12.2, -68.3), site('b', 12.0, -68.2), site('c', 20.6, -156.5)],
      box,
    );
    for (const s of map?.sites ?? []) {
      expect(s.x, s.id).toBeGreaterThanOrEqual(0);
      expect(s.x, s.id).toBeLessThanOrEqual(box.width);
      expect(s.y, s.id).toBeGreaterThanOrEqual(0);
      expect(s.y, s.id).toBeLessThanOrEqual(box.height);
    }
  });

  it('gives a single site a box rather than dividing by zero', () => {
    const map = buildSiteMap([site('only', 12.1, -68.29)], box);
    expect(map?.sites[0]?.x).toBeCloseTo(box.width / 2, 0);
    expect(map?.sites[0]?.y).toBeCloseTo(box.height / 2, 0);
    expect(map?.spanKm).toBeGreaterThan(0);
  });

  it('does not imply a continent for sites a few hundred metres apart', () => {
    // Without a floor on the span, two sites 300 m apart fill the plot and the
    // scale bar says the whole view is 300 m across — technically true and
    // completely misleading about what the diver is looking at.
    const map = buildSiteMap([site('a', 12.1, -68.29), site('b', 12.1027, -68.29)], box);
    expect(map?.spanKm).toBeGreaterThan(4);
  });

  it('narrows a longitude degree away from the equator', () => {
    // 1° of longitude is ~111 km at the equator and ~38 km at 70°N. A plot
    // that ignored this would call a Norwegian fjord three times its width.
    const tropics = buildSiteMap([site('a', 0, 0), site('b', 0, 1)], box);
    const arctic = buildSiteMap([site('a', 70, 0), site('b', 70, 1)], box);
    expect(arctic?.spanKm).toBeLessThan((tropics?.spanKm as number) / 2);
  });

  it('ignores coordinates that are not coordinates', () => {
    const map = buildSiteMap(
      [site('bad', 91, 0), site('worse', 0, 999), site('good', 12.1, -68.29)],
      box,
    );
    expect(map?.sites.map((s) => s.id)).toEqual(['good']);
  });

  it('returns nothing when no site has been located', () => {
    // Fifteen sites in the sample logbook, seven of them with no coordinates.
    // A plot of nothing should be absent, not empty.
    expect(buildSiteMap([], box)).toBeUndefined();
    expect(buildSiteMap([site('bad', Number.NaN, Number.NaN)], box)).toBeUndefined();
  });
});

describe('formatCoordinates', () => {
  it('writes the hemisphere rather than a minus sign', () => {
    expect(formatCoordinates(12.1, -68.29, 2)).toBe('12.10°N 68.29°W');
    expect(formatCoordinates(-33.87, 151.21, 2)).toBe('33.87°S 151.21°E');
  });

  it('keeps the equator and the meridian positive', () => {
    expect(formatCoordinates(0, 0, 1)).toBe('0.0°N 0.0°E');
  });
});

describe('placeLabels', () => {
  it('drops the label of a site whose name would land on another', () => {
    // Bonaire's shore sites are a few hundred metres apart. On a plot wide
    // enough to also show Hawaii their names overlap into a smear that reads
    // as a rendering bug rather than as a dense cluster.
    const map = buildSiteMap(
      [
        site('Angel City', 12.1, -68.29, 4),
        site('Salt Pier', 12.1005, -68.2905, 1),
        site('Karpata', 12.101, -68.291, 1),
        site('Molokini Back Wall', 20.63, -156.49, 2),
      ],
      box,
    );

    const labelled = map?.sites.filter((s) => s.showLabel).map((s) => s.id);
    expect(labelled).toContain('Angel City');
    expect(labelled).toContain('Molokini Back Wall');
    expect(labelled?.length).toBeLessThan(4);
  });

  it('keeps the name of the site the diver knows best', () => {
    const map = buildSiteMap(
      [site('rare', 12.1, -68.29, 1), site('favourite', 12.1001, -68.2901, 40)],
      box,
    );
    expect(map?.sites.find((s) => s.id === 'favourite')?.showLabel).toBe(true);
    expect(map?.sites.find((s) => s.id === 'rare')?.showLabel).toBe(false);
  });

  it('labels everything when nothing collides', () => {
    const map = buildSiteMap(
      [site('a', 12.1, -68.29), site('b', 20.6, -156.4), site('c', -33.8, 151.2)],
      box,
    );
    expect(map?.sites.every((s) => s.showLabel)).toBe(true);
  });

  it('still returns every marker, in the order it was given them', () => {
    // A site that loses its label keeps its dot, and the table below the plot
    // names all of them anyway.
    const map = buildSiteMap(
      [site('first', 12.1, -68.29, 1), site('second', 12.1001, -68.2901, 40)],
      box,
    );
    expect(map?.sites.map((s) => s.id)).toEqual(['first', 'second']);
  });
});

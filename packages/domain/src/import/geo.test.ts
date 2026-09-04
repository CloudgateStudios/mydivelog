import { describe, expect, it } from 'vitest';
import { distanceM, isValidCoordinate } from './geo.ts';
import { nameSimilarity } from './similarity.ts';

describe('distanceM', () => {
  it('is zero for the same point', () => {
    expect(distanceM({ lat: 12.1, lon: -68.29 }, { lat: 12.1, lon: -68.29 })).toBe(0);
  });

  it('measures the site-clustering radius', () => {
    // Each dive in the seed UDDF created a fresh site, so sites 200 m apart
    // are the same reef recorded twice.
    const metres = distanceM({ lat: 12.1, lon: -68.29 }, { lat: 12.1018, lon: -68.29 });
    expect(metres).toBeGreaterThan(190);
    expect(metres).toBeLessThan(210);
  });

  it('stays accurate at high latitude', () => {
    // A degree of longitude is 111 km at the equator and 19 km at 80°N. A flat
    // approximation is wrong by a factor of six there.
    const equator = distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const arctic = distanceM({ lat: 80, lon: 0 }, { lat: 80, lon: 1 });
    expect(equator).toBeGreaterThan(111_000);
    expect(arctic).toBeLessThan(20_000);
  });

  it('handles the antimeridian', () => {
    const metres = distanceM({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 });
    expect(metres).toBeLessThan(25_000);
  });
});

describe('isValidCoordinate', () => {
  it('accepts a real dive site', () => {
    expect(isValidCoordinate({ lat: 12.1, lon: -68.29 })).toBe(true);
  });

  it('rejects null island', () => {
    // 0,0 is in the Gulf of Guinea and is overwhelmingly a writer filling a
    // missing value with zeroes. Accepting it clusters every unlocated dive in
    // a file into one imaginary site.
    expect(isValidCoordinate({ lat: 0, lon: 0 })).toBe(false);
  });

  it('rejects out-of-range and non-finite values', () => {
    expect(isValidCoordinate({ lat: 91, lon: 0 })).toBe(false);
    expect(isValidCoordinate({ lat: 0, lon: 181 })).toBe(false);
    expect(isValidCoordinate({ lat: Number.NaN, lon: 0 })).toBe(false);
    expect(isValidCoordinate(undefined)).toBe(false);
  });
});

describe('nameSimilarity', () => {
  it('treats the written variants of one site as the same', () => {
    // These three all appear for one place in the wild.
    expect(nameSimilarity('1,000 Steps', '1000 Steps')).toBeGreaterThan(0.8);
    expect(nameSimilarity('Thousand Steps', 'thousand steps')).toBe(1);
  });

  it('scores a qualified name high but not exact', () => {
    const s = nameSimilarity('Angel City', 'Angel City Reef');
    expect(s).toBeGreaterThan(0.8);
    expect(s).toBeLessThan(1);
  });

  it('separates genuinely different sites', () => {
    expect(nameSimilarity('Angel City', 'Salt Pier')).toBeLessThan(0.5);
  });

  it('returns zero when a name is empty', () => {
    expect(nameSimilarity('', 'Angel City')).toBe(0);
  });
});

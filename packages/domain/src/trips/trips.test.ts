import { describe, expect, it } from 'vitest';
import { suggestTrips, type TripCandidateDive } from './index.ts';

const dive = (id: string, iso: string, siteName?: string, regionName?: string) =>
  ({
    id,
    startTimeLocal: new Date(iso),
    ...(siteName === undefined ? {} : { siteName }),
    ...(regionName === undefined ? {} : { regionName }),
  }) as TripCandidateDive;

const week = (prefix: string, start: number, days: number, region?: string) =>
  Array.from({ length: days }, (_, i) =>
    dive(
      `${prefix}${i}`,
      `2026-03-${String(start + i).padStart(2, '0')}T09:00:00Z`,
      'Angel City',
      region,
    ),
  );

describe('suggestTrips', () => {
  it('groups a week of diving into one trip', () => {
    const trips = suggestTrips(week('a', 2, 5, 'Bonaire'));
    expect(trips).toHaveLength(1);
    expect(trips[0]?.diveIds).toHaveLength(5);
    expect(trips[0]?.name).toBe('Bonaire, March 2026');
  });

  it('keeps a rest day inside the trip', () => {
    // A day off mid-week for a flight, a hangover, or a surface interval
    // before altitude. One trip, not two.
    const trips = suggestTrips([
      dive('a', '2026-03-02T09:00:00Z'),
      dive('b', '2026-03-03T09:00:00Z'),
      dive('c', '2026-03-06T09:00:00Z'),
    ]);
    expect(trips).toHaveLength(1);
  });

  it('splits two trips a month apart', () => {
    const trips = suggestTrips([...week('a', 2, 4, 'Bonaire'), ...week('b', 20, 4, 'Cozumel')]);
    expect(trips).toHaveLength(2);
    expect(trips.map((t) => t.name)).toEqual(['Bonaire, March 2026', 'Cozumel, March 2026']);
  });

  it('ignores a pair of dives at the local quarry', () => {
    // Two dives is a Saturday, not a trip worth naming.
    expect(
      suggestTrips([dive('a', '2026-03-02T09:00:00Z'), dive('b', '2026-03-02T13:00:00Z')]),
    ).toEqual([]);
  });

  it('counts three dives in one day as a trip, because they are three dives', () => {
    const trips = suggestTrips([
      dive('a', '2026-03-02T07:00:00Z'),
      dive('b', '2026-03-02T11:00:00Z'),
      dive('c', '2026-03-02T15:00:00Z'),
    ]);
    expect(trips).toHaveLength(1);
    // A trip that ran 07:00 to 15:00 ran for one day. Trip stores dates, not
    // times, so the suggestion is normalised to match.
    expect(trips[0]?.from.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    expect(trips[0]?.to.toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });

  it('names a trip after the region rather than a site', () => {
    // A trip is a place. "Angel City, March 2026" is a dive, not a holiday.
    const trips = suggestTrips(week('a', 2, 4, 'Bonaire'));
    expect(trips[0]?.name).toBe('Bonaire, March 2026');
  });

  it('falls back to the most-dived site when nothing recorded a region', () => {
    const trips = suggestTrips([
      dive('a', '2026-03-02T09:00:00Z', 'Salt Pier'),
      dive('b', '2026-03-03T09:00:00Z', 'Angel City'),
      dive('c', '2026-03-04T09:00:00Z', 'Angel City'),
    ]);
    expect(trips[0]?.name).toBe('Angel City, March 2026');
  });

  it('names the month when it knows nothing else', () => {
    const trips = suggestTrips([
      dive('a', '2026-03-02T09:00:00Z'),
      dive('b', '2026-03-03T09:00:00Z'),
      dive('c', '2026-03-04T09:00:00Z'),
    ]);
    expect(trips[0]?.name).toBe('March 2026');
  });

  it('breaks a tie the same way every time', () => {
    // A suggestion that changes between page loads reads as a bug.
    const dives = [
      dive('a', '2026-03-02T09:00:00Z', 'Zeta'),
      dive('b', '2026-03-03T09:00:00Z', 'Alpha'),
      dive('c', '2026-03-04T09:00:00Z', 'Zeta'),
      dive('d', '2026-03-05T09:00:00Z', 'Alpha'),
    ];
    expect(suggestTrips(dives)[0]?.name).toBe(suggestTrips([...dives].reverse())[0]?.name);
    expect(suggestTrips(dives)[0]?.name).toBe('Alpha, March 2026');
  });

  it('does not care what order it is given the dives in', () => {
    const forwards = suggestTrips(week('a', 2, 5, 'Bonaire'));
    const backwards = suggestTrips([...week('a', 2, 5, 'Bonaire')].reverse());
    expect(backwards[0]?.diveIds).toEqual(forwards[0]?.diveIds);
  });

  it('crosses a month boundary', () => {
    // 31 March to 1 April is one day apart; comparing day-of-month is not.
    const trips = suggestTrips([
      dive('a', '2026-03-30T09:00:00Z'),
      dive('b', '2026-03-31T09:00:00Z'),
      dive('c', '2026-04-01T09:00:00Z'),
    ]);
    expect(trips).toHaveLength(1);
  });

  it('has nothing to suggest for an empty logbook', () => {
    expect(suggestTrips([])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  computeIntervals,
  findDuplicateDiveNumbers,
  renumberDives,
  summarizeLog,
  surfaceAirConsumption,
} from './index.ts';

const at = (iso: string) => new Date(iso);

describe('renumberDives', () => {
  it('numbers chronologically and reports only what changes', () => {
    const changes = renumberDives([
      { id: 'b', startTimeUtc: at('2012-06-03T09:00:00Z'), diveNumber: 2 },
      { id: 'a', startTimeUtc: at('2012-06-02T09:00:00Z'), diveNumber: 1 },
      { id: 'c', startTimeUtc: at('2012-06-04T09:00:00Z'), diveNumber: 99 },
    ]);
    expect(changes).toEqual([{ id: 'c', from: 99, to: 3 }]);
  });

  it('renumbers everything after a forgotten dive is inserted', () => {
    // The reason dive number cannot be an identifier.
    const changes = renumberDives([
      { id: 'a', startTimeUtc: at('2012-06-02T09:00:00Z'), diveNumber: 1 },
      { id: 'new', startTimeUtc: at('2012-06-03T09:00:00Z'), diveNumber: null },
      { id: 'b', startTimeUtc: at('2012-06-04T09:00:00Z'), diveNumber: 2 },
      { id: 'c', startTimeUtc: at('2012-06-05T09:00:00Z'), diveNumber: 3 },
    ]);
    expect(changes).toEqual([
      { id: 'new', from: null, to: 2 },
      { id: 'b', from: 2, to: 3 },
      { id: 'c', from: 3, to: 4 },
    ]);
  });

  it('copes with the unnumbered rows the real workbook contains', () => {
    // Two rows in the sample spreadsheet are numbered "x", which parses to null.
    const changes = renumberDives([
      { id: 'x1', startTimeUtc: at('2021-09-01T09:00:00Z'), diveNumber: null },
      { id: 'x2', startTimeUtc: at('2021-09-02T09:00:00Z'), diveNumber: null },
    ]);
    expect(changes.map((c) => c.to)).toEqual([1, 2]);
  });

  it('is deterministic when two dives share a timestamp', () => {
    const dives = [
      { id: 'bbb', startTimeUtc: at('2012-06-02T09:00:00Z'), diveNumber: null },
      { id: 'aaa', startTimeUtc: at('2012-06-02T09:00:00Z'), diveNumber: null },
    ];
    expect(renumberDives(dives)).toEqual(renumberDives([...dives].reverse()));
  });

  it('rejects a nonsense starting number', () => {
    expect(() => renumberDives([], -1)).toThrow(RangeError);
  });
});

describe('findDuplicateDiveNumbers', () => {
  it('finds collisions and ignores nulls', () => {
    expect(
      findDuplicateDiveNumbers([
        { id: 'a', startTimeUtc: at('2020-01-01T00:00:00Z'), diveNumber: 5 },
        { id: 'b', startTimeUtc: at('2020-01-02T00:00:00Z'), diveNumber: 5 },
        { id: 'c', startTimeUtc: at('2020-01-03T00:00:00Z'), diveNumber: null },
      ]),
    ).toEqual([5]);
  });
});

describe('computeIntervals', () => {
  it('counts repetitive dives within a local day', () => {
    // Three Bonaire dives on one day, as the sample data has.
    const result = computeIntervals([
      { id: '1', startTimeUtc: at('2026-03-06T13:15:00Z'), durationS: 2700, tzOffsetMinutes: -240 },
      { id: '2', startTimeUtc: at('2026-03-06T15:16:00Z'), durationS: 2700, tzOffsetMinutes: -240 },
      { id: '3', startTimeUtc: at('2026-03-06T23:07:00Z'), durationS: 2776, tzOffsetMinutes: -240 },
    ]);
    expect(result.map((r) => r.repetitionIndex)).toEqual([1, 2, 3]);
    expect(result[0]!.surfaceIntervalS).toBeNull();
    expect(result[1]!.surfaceIntervalS).toBe(4560); // 15:16 minus 13:15+45min
  });

  it('starts a new day using local time, not UTC', () => {
    // 23:07 UTC on the 6th is 19:07 local at -04:00 — still the 6th.
    // 03:30 UTC on the 7th is 23:30 local on the 6th — also still the 6th.
    const result = computeIntervals([
      { id: '1', startTimeUtc: at('2026-03-06T23:07:00Z'), durationS: 1800, tzOffsetMinutes: -240 },
      { id: '2', startTimeUtc: at('2026-03-07T03:30:00Z'), durationS: 1800, tzOffsetMinutes: -240 },
    ]);
    expect(result.map((r) => r.repetitionIndex)).toEqual([1, 2]);
  });

  it('reports nothing rather than a negative interval when dives overlap', () => {
    const result = computeIntervals([
      { id: '1', startTimeUtc: at('2026-03-06T10:00:00Z'), durationS: 7200, tzOffsetMinutes: 0 },
      { id: '2', startTimeUtc: at('2026-03-06T11:00:00Z'), durationS: 1800, tzOffsetMinutes: 0 },
    ]);
    expect(result[1]!.surfaceIntervalS).toBeNull();
  });
});

describe('surfaceAirConsumption', () => {
  it('normalizes consumption to the surface', () => {
    // 200 -> 50 bar from an 11.1 L tank over 40 min at 20 m (3 ata).
    const sac = surfaceAirConsumption({
      startPressureBar: 200,
      endPressureBar: 50,
      tankVolumeL: 11.1,
      durationS: 2400,
      avgDepthM: 20,
    });
    expect(sac).toBeCloseTo(13.875, 3);
  });

  it('rejects impossible inputs instead of returning a plausible number', () => {
    const base = {
      startPressureBar: 200,
      endPressureBar: 50,
      tankVolumeL: 11.1,
      durationS: 2400,
      avgDepthM: 20,
    };
    expect(() => surfaceAirConsumption({ ...base, durationS: 0 })).toThrow(RangeError);
    expect(() => surfaceAirConsumption({ ...base, tankVolumeL: 0 })).toThrow(RangeError);
    expect(() => surfaceAirConsumption({ ...base, endPressureBar: 250 })).toThrow(RangeError);
    expect(() => surfaceAirConsumption({ ...base, avgDepthM: -1 })).toThrow(RangeError);
  });
});

describe('summarizeLog', () => {
  it('produces the dashboard totals, ignoring missing values', () => {
    const totals = summarizeLog([
      { durationS: 1860, maxDepthM: 5.18 },
      { durationS: 2700, maxDepthM: 14.1 },
      { durationS: null, maxDepthM: null },
    ]);
    expect(totals.diveCount).toBe(3);
    expect(totals.totalBottomTimeS).toBe(4560);
    expect(totals.maxDepthM).toBeCloseTo(14.1, 6);
    expect(totals.longestDiveS).toBe(2700);
    expect(totals.averageDepthM).toBeCloseTo(9.64, 2);
  });

  it('handles an empty log', () => {
    expect(summarizeLog([])).toEqual({
      diveCount: 0,
      totalBottomTimeS: 0,
      maxDepthM: null,
      longestDiveS: null,
      averageDepthM: null,
    });
  });
});

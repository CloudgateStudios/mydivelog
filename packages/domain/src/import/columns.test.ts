import { describe, expect, it } from 'vitest';
import { detectDerivedColumns } from './columns.ts';

// Shaped like the seed workbook: dive time as an Excel day fraction, a running
// total that sums it, and a time-out that is time-in plus duration.
const timeIn = [0.4118, 0.4645, 0.5312, 0.6001, 0.4402];
const diveTime = [0.0215, 0.0208, 0.0243, 0.0191, 0.0227];
const runningTotal = diveTime.reduce<number[]>((acc, v) => [...acc, (acc.at(-1) ?? 0) + v], []);
const timeOut = timeIn.map((t, i) => t + (diveTime[i] as number));
const maxDepth = [17, 21, 46, 33, 28];

describe('detectDerivedColumns', () => {
  const found = detectDerivedColumns({
    'Time In': timeIn,
    'Dive Time': diveTime,
    'Running Total Time': runningTotal,
    'Time Out': timeOut,
    'Max Depth (ft)': maxDepth,
  });
  const byColumn = new Map(found.map((f) => [f.column, f]));

  it('catches the running total', () => {
    expect(byColumn.get('Running Total Time')?.kind).toBe('cumulative');
    expect(byColumn.get('Running Total Time')?.from).toEqual(['Dive Time']);
  });

  it('catches time out as time in plus dive time', () => {
    expect(byColumn.get('Time Out')?.kind).toBe('sum');
    expect(byColumn.get('Time Out')?.from?.sort()).toEqual(['Dive Time', 'Time In']);
  });

  it('leaves real measurements alone', () => {
    // Losing max depth to an over-eager heuristic would be far worse than
    // importing a rollup.
    expect(byColumn.has('Max Depth (ft)')).toBe(false);
  });

  it('spares the measurement in a mutually-derivable triangle', () => {
    // `Dive Time` = `Time Out` − `Time In` is exactly true, so arithmetic alone
    // condemns the one column of the three that a diver actually recorded.
    // Settling sums first, then barring a derived column from being evidence,
    // is what keeps it.
    expect(byColumn.has('Dive Time')).toBe(false);
    expect(byColumn.has('Time In')).toBe(false);
    expect(byColumn.get('Time Out')?.kind).toBe('sum');
  });

  it('explains itself in words a diver can act on', () => {
    expect(byColumn.get('Running Total Time')?.explanation).toContain('running total');
  });
});

describe('detectDerivedColumns, edge cases', () => {
  it('does not flag a column that never changes', () => {
    // A constant is not a function of anything. The seed workbook's EAN % is
    // 33 on every row that has one, and calling that derived would throw away
    // the gas the diver actually breathed.
    const found = detectDerivedColumns({
      Depth: [17, 21, 46, 33],
      'Tank Size': [11.1, 11.1, 11.1, 11.1],
    });
    expect(found).toEqual([]);
  });

  it('does not judge a column from too few rows', () => {
    // Two rows satisfy almost any relationship by coincidence.
    expect(detectDerivedColumns({ a: [1, 2], b: [1, 2], c: [2, 4] })).toEqual([]);
  });

  it('ignores gaps rather than treating them as zero', () => {
    // Sparse columns are the norm: air temp is filled on 33 of 197 rows.
    const found = detectDerivedColumns({
      a: [1, 2, undefined, 4, 5],
      b: [10, 20, 30, 40, 50],
      sum: [11, 22, undefined, 44, 55],
    });
    expect(found.find((f) => f.column === 'sum')?.kind).toBe('sum');
  });

  it('does not call a correlated column derived', () => {
    // Depth roughly tracking duration is a fact about diving, not a formula.
    const found = detectDerivedColumns({
      duration: [30, 40, 50, 60, 45],
      depth: [18, 24, 31, 35, 27],
    });
    expect(found).toEqual([]);
  });

  it('returns nothing for a single column', () => {
    expect(detectDerivedColumns({ depth: [17, 21, 46, 33] })).toEqual([]);
  });

  it('handles a column that is entirely empty', () => {
    expect(() =>
      detectDerivedColumns({ a: [1, 2, 3, 4], empty: [undefined, undefined, undefined] }),
    ).not.toThrow();
  });
});

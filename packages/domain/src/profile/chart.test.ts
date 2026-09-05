import { describe, expect, it } from 'vitest';
import { buildProfileChart, buildProfileTable } from './chart.ts';

const dive = {
  timeS: [0, 60, 120, 180, 240],
  depthM: [0, 8, 14, 9, 0],
  tempC: [27, 26.5, 26, 26.4, 27],
};

describe('buildProfileChart', () => {
  const chart = buildProfileChart(dive);

  it('draws a point per sample', () => {
    expect(chart?.sampleCount).toBe(5);
    expect(chart?.path.split('L')).toHaveLength(5);
  });

  it('puts depth downward, the way a dive computer draws it', () => {
    // The deepest sample must have the largest y. Inverted, the shape is
    // misread at a glance by exactly the people who read these.
    const points = (chart?.path ?? '')
      .replace('M', '')
      .split('L')
      .map((p) => Number(p.split(',')[1]));
    const deepestIndex = dive.depthM.indexOf(Math.max(...dive.depthM));
    expect(Math.max(...points)).toBeCloseTo(points[deepestIndex] as number, 5);
  });

  it('closes the area back to the surface', () => {
    expect(chart?.area.endsWith('Z')).toBe(true);
    expect(chart?.area.startsWith(chart?.path ?? '')).toBe(true);
  });

  it('reports the maximum depth and duration', () => {
    expect(chart?.maxDepthM).toBe(14);
    expect(chart?.durationS).toBe(240);
  });

  it('rounds the depth axis out to whole gridlines', () => {
    // 14 m becomes a 15 m axis, so the labels are numbers a person would pick.
    expect(chart?.depthTicks.map((t) => t.label)).toEqual(['0m', '4m', '8m', '11m', '15m']);
  });

  it('draws temperature when the channel is there', () => {
    expect(chart?.temperaturePath).toBeDefined();
    expect(
      buildProfileChart({ timeS: dive.timeS, depthM: dive.depthM })?.temperaturePath,
    ).toBeUndefined();
  });

  it('handles a dive at one temperature throughout', () => {
    // Constant temperature is a flat line, not a division by zero.
    const flat = buildProfileChart({ ...dive, tempC: [26, 26, 26, 26, 26] });
    expect(flat?.temperaturePath).toBeDefined();
    expect(flat?.temperaturePath).not.toContain('NaN');
  });

  it('handles a profile whose clock does not start at zero', () => {
    // Some exports timestamp samples from the start of the day.
    const offset = buildProfileChart({
      timeS: [3600, 3660, 3720],
      depthM: [0, 10, 0],
    });
    expect(offset?.durationS).toBe(120);
    expect(offset?.timeTicks[0]?.label).toBe('0min');
  });

  it('returns nothing rather than a misleading picture', () => {
    expect(buildProfileChart({ timeS: [0], depthM: [0] })).toBeUndefined();
    expect(buildProfileChart({})).toBeUndefined();
    // Mismatched channel lengths mean the decode went wrong.
    expect(buildProfileChart({ timeS: [0, 1, 2], depthM: [0, 1] })).toBeUndefined();
    // A dive with no elapsed time cannot be plotted against time.
    expect(buildProfileChart({ timeS: [5, 5], depthM: [0, 1] })).toBeUndefined();
  });

  it('never emits NaN into a path', () => {
    for (const series of [dive, { timeS: [0, 1], depthM: [0, 0] }]) {
      const c = buildProfileChart(series);
      expect(c?.path).not.toContain('NaN');
      expect(c?.area).not.toContain('NaN');
    }
  });

  it('scales to the box it is given', () => {
    const small = buildProfileChart(dive, { width: 300, height: 100 });
    const xs = (small?.path ?? '')
      .replace('M', '')
      .split('L')
      .map((p) => Number(p.split(',')[0]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(300);
  });
});

describe('the table equivalent', () => {
  const ramp = (n: number, depth: (i: number) => number) => ({
    timeS: Array.from({ length: n }, (_, i) => i * 10),
    depthM: Array.from({ length: n }, (_, i) => depth(i)),
  });

  it('always includes the deepest sample, even between evenly spaced rows', () => {
    // The whole reason this is not a plain every-nth-sample slice. Sample 97
    // of 200 is the deepest and no even step lands on it.
    const series = ramp(200, (i) => (i === 97 ? 41.2 : 20));
    const table = buildProfileTable(series);

    const deepest = table.filter((row) => row.isDeepest);
    expect(deepest).toHaveLength(1);
    expect(deepest[0]?.depthM).toBe(41.2);
  });

  it('starts at zero seconds however the samples are timestamped', () => {
    // A dive computer's clock starts wherever it likes; "12 minutes in" is
    // what a person reads.
    const table = buildProfileTable({ timeS: [3600, 3660, 3720], depthM: [0, 18, 0] });
    expect(table[0]?.timeS).toBe(0);
    expect(table.at(-1)?.timeS).toBe(120);
  });

  it('keeps both ends of the dive', () => {
    const table = buildProfileTable(ramp(200, (i) => i / 10));
    expect(table[0]?.timeS).toBe(0);
    expect(table.at(-1)?.timeS).toBe(1990);
  });

  it('stays short enough to read', () => {
    expect(buildProfileTable(ramp(2000, () => 20)).length).toBeLessThanOrEqual(16);
  });

  it('does not invent a temperature the profile does not carry', () => {
    const table = buildProfileTable(ramp(10, () => 20));
    expect(table.every((row) => row.tempC === undefined)).toBe(true);
  });

  it('ignores a temperature channel of the wrong length', () => {
    // A mismatched channel means the decode went wrong; pairing it with depth
    // by index would attach readings to the wrong moments.
    const table = buildProfileTable({ timeS: [0, 10, 20], depthM: [0, 5, 0], tempC: [26] });
    expect(table.every((row) => row.tempC === undefined)).toBe(true);
  });

  it('returns nothing rather than something wrong for an unusable profile', () => {
    expect(buildProfileTable({ timeS: [], depthM: [] })).toEqual([]);
    expect(buildProfileTable({ timeS: [0, 10], depthM: [0] })).toEqual([]);
  });

  it('handles a single sample, which is not a curve but is a record', () => {
    expect(buildProfileTable({ timeS: [0], depthM: [3.2] })).toEqual([
      { timeS: 0, depthM: 3.2, isDeepest: true },
    ]);
  });
});

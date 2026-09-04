import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeProfile, encodeProfile, summarizeProfile, type ProfileSeries } from './index.ts';

/** Pulls the first dive's waypoints out of the committed UDDF fixture. */
function fixtureProfile(): ProfileSeries {
  const path = fileURLToPath(new URL('../../../../fixtures/uddf-sample.uddf', import.meta.url));
  const xml = readFileSync(path, 'utf8');
  const dive = xml.slice(xml.indexOf('<dive '), xml.indexOf('</dive>'));

  const timeS: number[] = [];
  const depthM: number[] = [];
  const tempC: number[] = [];
  for (const m of dive.matchAll(/<waypoint>([\s\S]*?)<\/waypoint>/g)) {
    const wp = m[1] as string;
    const d = wp.match(/<depth>([-\d.]+)<\/depth>/);
    const t = wp.match(/<divetime>([-\d.]+)<\/divetime>/);
    const k = wp.match(/<temperature>([-\d.]+)<\/temperature>/);
    if (!d || !t) continue;
    depthM.push(Number(d[1]));
    timeS.push(Number(t[1]));
    tempC.push(k ? Number(k[1]) - 273.15 : (tempC.at(-1) ?? 0)); // kelvin in UDDF
  }
  return { timeS, depthM, tempC };
}

describe('mdl-profile-v1', () => {
  it('round-trips synthetic data exactly', () => {
    const series: ProfileSeries = {
      timeS: [0, 15, 30, 45],
      depthM: [0, 1.786, 4.221, 9.05],
      tempC: [26.59, 26.59, 26.6, 26.49],
    };
    const decoded = decodeProfile(encodeProfile(series));
    expect(decoded.timeS).toEqual(series.timeS);
    expect(decoded.depthM).toEqual(series.depthM);
    expect(decoded.tempC).toEqual(series.tempC);
  });

  it('round-trips the real UDDF fixture without loss at stored precision', () => {
    const series = fixtureProfile();
    expect(series.depthM!.length).toBeGreaterThan(30);

    const decoded = decodeProfile(encodeProfile(series));

    // Depth is stored to the millimetre, temperature to a hundredth of a degree.
    decoded.depthM!.forEach((v, i) => expect(v).toBeCloseTo(series.depthM![i]!, 3));
    decoded.tempC!.forEach((v, i) => expect(v).toBeCloseTo(series.tempC![i]!, 2));
    expect(decoded.timeS).toEqual(series.timeS);
  });

  it('meets the size budget: a 208-sample profile encodes to under 2 KB', () => {
    // The acceptance criterion in docs/11-roadmap.md. 208 samples at 15s is the
    // shape the sample export actually produces.
    const timeS: number[] = [];
    const depthM: number[] = [];
    const tempC: number[] = [];
    for (let i = 0; i < 208; i += 1) {
      timeS.push(i * 15);
      depthM.push(14 * Math.sin((Math.PI * i) / 207) + (i % 3) * 0.02);
      tempC.push(26.6 - (i % 7) * 0.01);
    }
    const encoded = encodeProfile({ timeS, depthM, tempC });
    expect(encoded.byteLength).toBeLessThan(2048);

    const decoded = decodeProfile(encoded);
    decoded.depthM!.forEach((v, i) => expect(v).toBeCloseTo(depthM[i]!, 3));
  });

  it('rejects corrupt input rather than returning nonsense', () => {
    expect(() => decodeProfile(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/bad magic/);
    const good = encodeProfile({ timeS: [0, 1], depthM: [0, 1] });
    const truncated = good.slice(0, good.length - 1);
    expect(() => decodeProfile(truncated)).toThrow();
  });

  it('rejects mismatched channel lengths and non-finite values', () => {
    expect(() => encodeProfile({ timeS: [0, 1], depthM: [0] })).toThrow(/same length/);
    expect(() => encodeProfile({ depthM: [0, Number.NaN] })).toThrow(/finite/);
  });
});

describe('summarizeProfile', () => {
  it('derives the values denormalized onto the dive row', () => {
    const s = summarizeProfile(fixtureProfile());
    expect(s.sampleCount).toBeGreaterThan(30);
    expect(s.maxDepthM).toBeGreaterThan(1);
    expect(s.avgDepthM).toBeGreaterThan(0);
    expect(s.avgDepthM).toBeLessThanOrEqual(s.maxDepthM);
    expect(s.durationS).toBeGreaterThan(0);
    expect(s.channels).toEqual(['timeS', 'depthM', 'tempC']);
    expect(s.minTempC).toBeLessThanOrEqual(s.maxTempC!);
  });

  it('computes ascent rate as a historical observation', () => {
    const s = summarizeProfile({ timeS: [0, 60], depthM: [20, 10] });
    expect(s.maxAscentRateMPerMin).toBeCloseTo(10, 6);
  });
});

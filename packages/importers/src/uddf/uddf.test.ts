import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TzResolver } from '@mydivelog/domain';
import { parseUddf } from './index.ts';

const fixture = readFileSync(
  fileURLToPath(new URL('../../../../fixtures/uddf-sample.uddf', import.meta.url)),
  'utf8',
);

/** Bonaire and the other Caribbean sites in the fixture are all -04:00. */
const atlantic: TzResolver = () => -240;

describe('parseUddf against the real Oceanic+ export', () => {
  const { observations, fileIssues } = parseUddf(fixture, { resolveTz: atlantic });

  it('reads every dive in the file', () => {
    expect(observations).toHaveLength(6);
    expect(fileIssues).toEqual([]);
  });

  it('carries the source id so a re-import is idempotent', () => {
    expect(observations.every((o) => o.sourceRef?.startsWith('dive_'))).toBe(true);
    expect(new Set(observations.map((o) => o.sourceRef)).size).toBe(6);
  });

  it('repairs every malformed offset in the file', () => {
    // This is the finding the whole timezone rule exists for. Without it every
    // dive here lands four hours from where it belongs.
    const repairs = observations.flatMap((o) =>
      o.normalizations.filter((n) => n.field === 'startTime.offsetMinutes'),
    );
    expect(repairs).toHaveLength(6);
    expect(repairs.every((r) => r.confidence === 'high')).toBe(true);
    expect(repairs.every((r) => r.to === -240)).toBe(true);
    expect(observations.every((o) => o.startTime.offsetSuspect !== true)).toBe(true);
  });

  it('keeps the local time the diver remembers and derives UTC from it', () => {
    const dive = observations.find((o) => o.sourceRef === 'dive_69ab7a96dce6e40c7d3abe65');
    expect(dive?.startTime.local?.toISOString()).toBe('2026-03-06T19:07:42.000Z');
    expect(dive?.startTime.utc?.toISOString()).toBe('2026-03-06T23:07:42.000Z');
    expect(dive?.startTime.offsetMinutes).toBe(-240);
    // The original text survives for the audit trail.
    expect(dive?.startTime.raw).toBe('2026-03-06T19:07:42.000-00:04');
  });

  it('reads the worked example’s measurements', () => {
    // The dive that also appears in the spreadsheet as 46 ft.
    const dive = observations.find((o) => o.sourceRef === 'dive_69ab7a96dce6e40c7d3abe65');
    expect(dive?.maxDepthM).toBeCloseTo(14.099043, 6);
    expect(dive?.durationS).toBe(2776);
    expect(dive?.waterTempMinC).toBeCloseTo(26.49, 2);
  });

  it('drops the leadquantity sentinel on every dive', () => {
    // 0.0 on all of them. Importing it would let a worthless value out-rank
    // the spreadsheet's real weight during merge.
    expect(observations.every((o) => o.weightKg === undefined)).toBe(true);
    const dropped = observations.filter((o) =>
      o.issues.some((i) => i.code === 'sentinel_dropped' && i.field === 'weightKg'),
    );
    expect(dropped).toHaveLength(6);
  });

  it('keeps site coordinates but not the opaque site name', () => {
    const dive = observations.find((o) => o.sourceRef === 'dive_69ab7a96dce6e40c7d3abe65');
    expect(dive?.site?.name).toBeUndefined();
    expect(dive?.site?.lat).toBeDefined();
    expect(dive?.site?.lon).toBeDefined();
  });

  it('reads the gas the computer actually sensed', () => {
    // EAN 33, against the spreadsheet's EAN 32. Both are kept; merge decides.
    const dive = observations.find((o) => o.sourceRef === 'dive_69ab7a96dce6e40c7d3abe65');
    expect(dive?.gases?.[0]?.o2Fraction).toBeCloseTo(0.33, 2);
    expect(dive?.gases?.[0]?.label).toBe('nitrox');
  });

  it('decodes the depth profile', () => {
    const dive = observations.find((o) => o.sourceRef === 'dive_69ab7a96dce6e40c7d3abe65');
    const profile = dive?.profile;
    expect(profile?.timeS?.length).toBeGreaterThan(20);
    expect(profile?.depthM?.length).toBe(profile?.timeS?.length);
    expect(profile?.tempC?.length).toBe(profile?.timeS?.length);
    expect(profile?.timeS?.[0]).toBe(0);

    // Not equal to greatestdepth: the committed fixture is downsampled, so the
    // deepest surviving waypoint sits above the deepest recorded moment. That
    // a sampled curve never exceeds the reported maximum is the invariant that
    // holds for both the fixture and the full file.
    const deepest = Math.max(...(profile?.depthM ?? []));
    expect(deepest).toBeLessThanOrEqual((dive?.maxDepthM ?? 0) + 1e-6);
    expect(deepest).toBeGreaterThan(10);
  });

  it('keeps the profile monotonic in time', () => {
    for (const o of observations) {
      const t = o.profile?.timeS ?? [];
      for (let i = 1; i < t.length; i++) {
        expect(t[i], `dive ${o.sourceRef} sample ${i}`).toBeGreaterThan(t[i - 1] as number);
      }
    }
  });

  it('converts profile temperatures out of kelvin', () => {
    const profile = observations[0]?.profile;
    // 299.74 K is 26.6 °C. Left in kelvin it would read as a lethal fever.
    expect(Math.max(...(profile?.tempC ?? []))).toBeLessThan(40);
    expect(Math.min(...(profile?.tempC ?? []))).toBeGreaterThan(0);
  });

  it('backfills the first waypoint’s missing temperature', () => {
    // The first waypoint of every dive carries a gas switch and no
    // temperature. Left as NaN it would poison the profile codec.
    for (const o of observations) {
      expect(o.profile?.tempC?.every((v) => Number.isFinite(v)) ?? true).toBe(true);
    }
  });

  it('never returns an empty observation for a dive that exists', () => {
    for (const o of observations) {
      expect(o.startTime.utc).toBeDefined();
      expect(o.raw).toBeDefined();
    }
  });
});

describe('parseUddf without a timezone resolver', () => {
  it('leaves the suspect offsets alone and flags them', () => {
    // No geography to corroborate against, so the file's value stands and a
    // human is asked. Guessing would be worse.
    const { observations } = parseUddf(fixture);
    expect(observations.every((o) => o.startTime.offsetSuspect === true)).toBe(true);
    expect(observations.every((o) => o.startTime.offsetMinutes === -4)).toBe(true);
    expect(
      observations.every((o) =>
        o.normalizations.some((n) => n.confidence === 'low' && n.reason.includes('-04:00')),
      ),
    ).toBe(true);
  });
});

describe('parseUddf on files that are not this file', () => {
  it('reports a truncated file rather than importing an empty logbook', () => {
    // The parser is lenient enough to return a plausible tree from this, so
    // without an explicit validation pass a half-downloaded file looks exactly
    // like a file that legitimately contains no dives.
    const r = parseUddf('<uddf><profiledata>');
    expect(r.observations).toEqual([]);
    expect(r.fileIssues[0]?.code).toBe('unparseable_xml');
  });

  it('reports a truncated copy of the real file', () => {
    const r = parseUddf(fixture.slice(0, Math.floor(fixture.length / 2)));
    expect(r.observations).toEqual([]);
    expect(r.fileIssues[0]?.code).toBe('unparseable_xml');
  });

  it('reports a file that is not XML at all', () => {
    const r = parseUddf('Dive Number,Date,Time In\n1,41062,0.41');
    expect(r.fileIssues[0]?.code).toBe('unparseable_xml');
  });

  it('reports a file that is XML but not UDDF', () => {
    const r = parseUddf('<?xml version="1.0"?><dives><dive/></dives>');
    expect(r.fileIssues[0]?.code).toBe('not_uddf');
  });

  it('reports an empty UDDF rather than pretending it worked', () => {
    const r = parseUddf('<?xml version="1.0"?><uddf version="3.2.1"></uddf>');
    expect(r.observations).toEqual([]);
    expect(r.fileIssues[0]?.code).toBe('no_dives');
  });

  it('keeps a dive whose start time is unreadable, with an issue on it', () => {
    // Errors are per-row. One bad date must not cost the diver the other 195.
    const r = parseUddf(`<?xml version="1.0"?><uddf version="3.2.1"><profiledata>
      <repetitiongroup>
        <dive id="dive_a"><informationbeforedive><datetime>not a date</datetime></informationbeforedive></dive>
        <dive id="dive_b"><informationbeforedive><datetime>2026-03-06T19:07:42Z</datetime></informationbeforedive></dive>
      </repetitiongroup></profiledata></uddf>`);
    expect(r.observations).toHaveLength(2);
    expect(r.observations[0]?.issues[0]?.code).toBe('unreadable_datetime');
    expect(r.observations[1]?.startTime.utc).toBeDefined();
  });

  it('handles a single dive, which the XML parser hands back unwrapped', () => {
    // fast-xml-parser gives an object for one child and an array for many. A
    // logbook with exactly one dive is a real thing.
    const r = parseUddf(`<?xml version="1.0"?><uddf version="3.2.1"><profiledata>
      <repetitiongroup><dive id="dive_only"><informationbeforedive>
      <datetime>2026-03-06T19:07:42Z</datetime></informationbeforedive></dive></repetitiongroup>
      </profiledata></uddf>`);
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]?.sourceRef).toBe('dive_only');
  });

  it('handles a dive with no samples', () => {
    const r = parseUddf(`<?xml version="1.0"?><uddf version="3.2.1"><profiledata>
      <repetitiongroup><dive id="d"><informationbeforedive>
      <datetime>2026-03-06T19:07:42Z</datetime></informationbeforedive></dive></repetitiongroup>
      </profiledata></uddf>`);
    expect(r.observations[0]?.profile).toBeUndefined();
  });
});

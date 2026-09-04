/**
 * `mdl-profile-v1` — the on-disk format for dive profile time series.
 *
 * Why a custom format: the sample UDDF carries 20,014 waypoints for 96 dives
 * and is 48x the size of a 197-row spreadsheet. Profiles are written once, read
 * whole, and never queried per-sample, so they live in object storage with only
 * a summary in Postgres (docs/04-data-model.md § Profile Storage).
 *
 * The encoding is columnar, delta-coded and varint-packed. Columnar because a
 * depth series compresses far better beside itself than interleaved with
 * temperature; delta because consecutive samples differ by very little; varint
 * because those deltas then fit in a byte.
 *
 * This module is pure by design — no compression, no I/O — so it stays inside
 * packages/domain's constraints. Callers may gzip or zstd the result; on real
 * data the encoding alone is already small enough that compression is an
 * optimisation rather than a requirement.
 *
 * Layout:
 *   magic "MDL1"        4 bytes
 *   version             1 byte
 *   channel mask        1 byte
 *   sample count        varint
 *   per present channel, in channel order:
 *     first value       zigzag varint (scaled integer)
 *     n-1 deltas        zigzag varint
 */

export const PROFILE_FORMAT = 'mdl-profile-v1';

const MAGIC = [0x4d, 0x44, 0x4c, 0x31]; // "MDL1"
const VERSION = 1;

/** Channels, in the order they are written. Scales fix the stored precision. */
const CHANNELS = [
  { name: 'timeS', bit: 1 << 0, scale: 1 }, // whole seconds
  { name: 'depthM', bit: 1 << 1, scale: 1000 }, // millimetres
  { name: 'tempC', bit: 1 << 2, scale: 100 }, // hundredths of a degree
  { name: 'pressureBar', bit: 1 << 3, scale: 100 },
  { name: 'ndlS', bit: 1 << 4, scale: 1 },
  { name: 'cnsPercent', bit: 1 << 5, scale: 100 },
] as const;

export type ChannelName = (typeof CHANNELS)[number]['name'];

export type ProfileSeries = {
  [K in ChannelName]?: readonly number[];
};

class ByteWriter {
  private bytes: number[] = [];

  byte(v: number): void {
    this.bytes.push(v & 0xff);
  }

  /** LEB128. Small magnitudes cost one byte, which is the point. */
  varint(value: number): void {
    let v = value >>> 0;
    while (v >= 0x80) {
      this.bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.bytes.push(v);
  }

  /** Zigzag, so small negative deltas stay small. */
  zigzag(value: number): void {
    this.varint(((value << 1) ^ (value >> 31)) >>> 0);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class ByteReader {
  private i = 0;
  constructor(private readonly buf: Uint8Array) {}

  byte(): number {
    const v = this.buf[this.i];
    if (v === undefined) throw new Error('mdl-profile: unexpected end of input');
    this.i += 1;
    return v;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error('mdl-profile: varint too long');
    }
    return result >>> 0;
  }

  zigzag(): number {
    const v = this.varint();
    return (v >>> 1) ^ -(v & 1);
  }

  get done(): boolean {
    return this.i >= this.buf.length;
  }
}

function sampleCountOf(series: ProfileSeries): number {
  const lengths = CHANNELS.map((c) => series[c.name]?.length).filter(
    (n): n is number => n !== undefined,
  );
  if (lengths.length === 0) throw new Error('mdl-profile: no channels supplied');
  const [first] = lengths;
  if (lengths.some((n) => n !== first)) {
    throw new Error('mdl-profile: all channels must have the same length');
  }
  return first as number;
}

export function encodeProfile(series: ProfileSeries): Uint8Array {
  const count = sampleCountOf(series);
  const present = CHANNELS.filter((c) => series[c.name] !== undefined);

  const w = new ByteWriter();
  for (const b of MAGIC) w.byte(b);
  w.byte(VERSION);
  w.byte(present.reduce((mask, c) => mask | c.bit, 0));
  w.varint(count);

  for (const channel of present) {
    const values = series[channel.name] as readonly number[];
    let previous = 0;
    for (let i = 0; i < count; i += 1) {
      const raw = values[i];
      if (raw === undefined || !Number.isFinite(raw)) {
        throw new Error(`mdl-profile: ${channel.name}[${i}] is not a finite number`);
      }
      const scaled = Math.round(raw * channel.scale);
      w.zigzag(scaled - previous);
      previous = scaled;
    }
  }

  return w.finish();
}

export function decodeProfile(bytes: Uint8Array): ProfileSeries {
  const r = new ByteReader(bytes);
  for (const expected of MAGIC) {
    if (r.byte() !== expected) throw new Error('mdl-profile: bad magic');
  }
  const version = r.byte();
  if (version !== VERSION) {
    throw new Error(`mdl-profile: unsupported version ${version}`);
  }

  const mask = r.byte();
  const count = r.varint();
  const out: Record<string, number[]> = {};

  for (const channel of CHANNELS) {
    if ((mask & channel.bit) === 0) continue;
    const values: number[] = new Array(count);
    let previous = 0;
    for (let i = 0; i < count; i += 1) {
      previous += r.zigzag();
      values[i] = previous / channel.scale;
    }
    out[channel.name] = values;
  }

  return out as ProfileSeries;
}

/** Summary values denormalized onto the dive row for querying and sorting. */
export type ProfileSummary = {
  sampleCount: number;
  durationS: number;
  maxDepthM: number;
  avgDepthM: number;
  minTempC?: number;
  maxTempC?: number;
  maxAscentRateMPerMin?: number;
  intervalS?: number;
  channels: ChannelName[];
};

export function summarizeProfile(series: ProfileSeries): ProfileSummary {
  const count = sampleCountOf(series);
  const depth = series.depthM ?? [];
  const time = series.timeS ?? [];
  const temp = series.tempC;

  const maxDepthM = depth.length ? Math.max(...depth) : 0;
  const avgDepthM = depth.length ? depth.reduce((a, b) => a + b, 0) / depth.length : 0;
  const durationS = time.length ? (time[time.length - 1] as number) - (time[0] as number) : 0;

  // Ascent rate is a diagnostic on a past dive, never advice about a future
  // one — see docs/10-security-privacy.md § Liability.
  let maxAscentRateMPerMin: number | undefined;
  if (depth.length > 1 && time.length === depth.length) {
    let fastest = 0;
    for (let i = 1; i < depth.length; i += 1) {
      const dt = (time[i] as number) - (time[i - 1] as number);
      if (dt <= 0) continue;
      const ascent = (depth[i - 1] as number) - (depth[i] as number); // positive going up
      if (ascent > 0) fastest = Math.max(fastest, (ascent / dt) * 60);
    }
    maxAscentRateMPerMin = fastest;
  }

  let intervalS: number | undefined;
  if (time.length > 1) {
    intervalS = Math.round(
      ((time[time.length - 1] as number) - (time[0] as number)) / (time.length - 1),
    );
  }

  const summary: ProfileSummary = {
    sampleCount: count,
    durationS,
    maxDepthM,
    avgDepthM,
    channels: CHANNELS.filter((c) => series[c.name] !== undefined).map((c) => c.name),
  };
  if (temp?.length) {
    summary.minTempC = Math.min(...temp);
    summary.maxTempC = Math.max(...temp);
  }
  if (maxAscentRateMPerMin !== undefined) summary.maxAscentRateMPerMin = maxAscentRateMPerMin;
  if (intervalS !== undefined) summary.intervalS = intervalS;
  return summary;
}

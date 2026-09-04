/**
 * Field-level merge.
 *
 * When an observation resolves onto an existing dive, each field is decided
 * independently. That is the whole point: the seed spreadsheet knows the site
 * is called Angel City and the dive computer knows where Angel City is, and
 * the merged dive should hold both.
 *
 * Precedence is per field class, never global. A watch has no opinion about
 * whether a dive was any good, and a diver's memory of their maximum depth is
 * not better than the instrument that was there.
 */

export const SOURCE_ORIGINS = ['instrument', 'manual', 'file_import', 'derived'] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

/**
 * How much a source kind's assertions are worth.
 *
 * `spreadsheet` is `file_import` rather than `manual` because a diver typing
 * into their own workbook years ago is still less current than one editing the
 * dive in front of them — but it is human-authored, which is what earns it the
 * subjective and identifying fields over any instrument.
 */
export const SOURCE_ORIGIN_BY_KIND: Readonly<Record<string, SourceOrigin>> = {
  uddf: 'instrument',
  'api:garmin': 'instrument',
  shearwater: 'instrument',
  manual: 'manual',
  spreadsheet: 'file_import',
  subsurface: 'file_import',
  csv: 'file_import',
  derived: 'derived',
};

export function originOf(sourceKind: string): SourceOrigin {
  return SOURCE_ORIGIN_BY_KIND[sourceKind] ?? 'file_import';
}

/** Is this origin a machine that was present, rather than a person recalling? */
const isInstrument = (origin: SourceOrigin): boolean => origin === 'instrument';

export const FIELD_CLASSES = [
  'measured',
  'subjective',
  'identifying',
  'configured',
  'geographic',
] as const;
export type FieldClass = (typeof FIELD_CLASSES)[number];

/**
 * Which class each field belongs to.
 *
 * Anything unlisted defaults to `measured`, which prefers the instrument. That
 * default is the conservative one for a new numeric field; a new *subjective*
 * field added without a class here would be resolved wrongly, so the list is
 * meant to be extended alongside the schema.
 */
export const FIELD_CLASS: Readonly<Record<string, FieldClass>> = {
  // Time is measured, and listed rather than left to the default: a dive
  // computer's 09:13:07 is better than a diver's remembered 09:13, and this
  // being deliberate matters more than most — the whole logbook sorts by it.
  startTimeLocal: 'measured',
  startTimeUtc: 'measured',
  tzOffsetMinutes: 'measured',

  maxDepthM: 'measured',
  avgDepthM: 'measured',
  durationS: 'measured',
  waterTempMinC: 'measured',
  airTempC: 'measured',
  profile: 'measured',

  notes: 'subjective',
  rating: 'subjective',
  visibilityM: 'subjective',
  buddies: 'subjective',
  waterType: 'subjective',

  'site.name': 'identifying',
  'site.regionHint': 'identifying',
  diveNumber: 'identifying',
  tags: 'identifying',

  gases: 'configured',
  tanks: 'configured',
  weightKg: 'configured',
  gear: 'configured',

  'site.lat': 'geographic',
  'site.lon': 'geographic',
  'site.altitudeM': 'geographic',
};

export function classOf(fieldPath: string): FieldClass {
  return FIELD_CLASS[fieldPath] ?? 'measured';
}

/**
 * Preferred origins per class, best first.
 *
 * The subjective and identifying orderings put every human ahead of every
 * instrument, which is the substance of the whole table: a computer emits
 * `site_69ab7a96dce6e40c7d3abe65` and a person writes `Angel City`.
 */
export const CLASS_PREFERENCE: Readonly<Record<FieldClass, readonly SourceOrigin[]>> = {
  measured: ['instrument', 'manual', 'file_import', 'derived'],
  geographic: ['instrument', 'manual', 'file_import', 'derived'],
  subjective: ['manual', 'file_import', 'instrument', 'derived'],
  identifying: ['manual', 'file_import', 'instrument', 'derived'],
  // Divers configure gas and weight by hand, so a human wins — unless the
  // instrument sensed it, which `sensed` marks. The seed file's computer read
  // 33% oxygen from the analyser while the diver wrote EAN 32 from memory.
  configured: ['manual', 'file_import', 'instrument', 'derived'],
};

export type Contribution<T = unknown> = {
  sourceId: string;
  sourceKind: string;
  /** When the source captured this, not when we imported it. */
  recordedAt: Date;
  value: T;
  /** Set when an instrument measured this rather than being told it. */
  sensed?: boolean;
};

export type Provenance<T = unknown> = {
  fieldPath: string;
  sourceId: string;
  value: T;
  isSelected: boolean;
  confidence: number;
};

export type FieldResolution<T = unknown> = {
  fieldPath: string;
  value?: T;
  /** Which source the shown value came from. */
  sourceId?: string;
  /**
   * Two sources of equal standing assert different values. Both are kept, one
   * is shown, and the dive is flagged so the disagreement is surfaced rather
   * than buried.
   */
  contested: boolean;
  provenance: Provenance<T>[];
};

const rank = (fieldPath: string, contribution: Contribution): number => {
  const order = CLASS_PREFERENCE[classOf(fieldPath)];
  const origin = originOf(contribution.sourceKind);
  // A sensed reading is an instrument doing what instruments are for, so it
  // outranks a human's configuration of the same field.
  if (classOf(fieldPath) === 'configured' && contribution.sensed === true && isInstrument(origin)) {
    return -1;
  }
  const index = order.indexOf(origin);
  return index === -1 ? order.length : index;
};

/** Deep-ish equality, enough for the scalar and small-array values fields hold. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    // Sources round differently. 46 ft is 14.0208 m and the computer said
    // 14.099043; those are not the same value, but 14.0208 and 14.02080000001
    // are, and only one of those distinctions is worth flagging to a diver.
    return Math.abs(a - b) < 1e-9;
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return (
      ka.length === kb.length &&
      ka.every((k) =>
        sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}

/**
 * Resolves one field across every source that asserted it.
 *
 * Rule 1 is enforced by construction: contributions holding `undefined` are
 * dropped before ranking, so a field with a value never loses to a field
 * without one regardless of precedence. That is why the `leadquantity`
 * sentinel had to be stripped at parse time — as a `0` it would have arrived
 * here as a genuine value from an instrument and won.
 */
export function resolveField<T>(
  fieldPath: string,
  contributions: readonly Contribution<T>[],
): FieldResolution<T> {
  const present = contributions.filter((c) => c.value !== undefined && c.value !== null);
  if (present.length === 0) {
    return { fieldPath, contested: false, provenance: [] };
  }

  if (fieldPath === 'notes') {
    return appendNotes(fieldPath, present as readonly Contribution<string>[]) as FieldResolution<T>;
  }

  const sorted = [...present].sort((a, b) => {
    const byRank = rank(fieldPath, a) - rank(fieldPath, b);
    if (byRank !== 0) return byRank;
    // Equal standing: the more recent record wins.
    return b.recordedAt.getTime() - a.recordedAt.getTime();
  });

  const winner = sorted[0] as Contribution<T>;
  const contested = sorted
    .slice(1)
    .some(
      (c) => rank(fieldPath, c) === rank(fieldPath, winner) && !sameValue(c.value, winner.value),
    );

  return {
    fieldPath,
    value: winner.value,
    sourceId: winner.sourceId,
    contested,
    provenance: sorted.map((c) => ({
      fieldPath,
      sourceId: c.sourceId,
      value: c.value,
      isSelected: c.sourceId === winner.sourceId,
      confidence: 1,
    })),
  };
}

/**
 * Notes never overwrite. They append, with attribution.
 *
 * Notes are irreplaceable and genuinely unmergeable — there is no rule that
 * combines two people's prose correctly. Concatenating with a source label is
 * imperfect, but it never destroys anything, and destroying a dive note is not
 * recoverable from a provenance row the diver has to go looking for.
 */
function appendNotes(
  fieldPath: string,
  contributions: readonly Contribution<string>[],
): FieldResolution<string> {
  const ordered = [...contributions].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );

  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of ordered) {
    const text = String(c.value).trim();
    // The same note arriving from two sources is one note, not two.
    if (text === '' || seen.has(text)) continue;
    seen.add(text);
    parts.push(ordered.length > 1 ? `${text}\n\n— ${c.sourceKind}` : text);
  }

  const first = ordered[0];
  return {
    fieldPath,
    value: parts.join('\n\n'),
    ...(first === undefined ? {} : { sourceId: first.sourceId }),
    contested: false,
    provenance: ordered.map((c) => ({
      fieldPath,
      sourceId: c.sourceId,
      value: c.value,
      // Every note is kept, so every one is part of what the dive shows.
      isSelected: true,
      confidence: 1,
    })),
  };
}

export type MergedDive = {
  fields: Record<string, FieldResolution>;
  /** Surfaced in the UI, not buried. */
  hasContestedFields: boolean;
  contestedFields: string[];
};

/**
 * Resolves every field a set of sources touched.
 *
 * Sources are passed as flattened field maps rather than observations so that
 * an existing dive's current values participate on the same footing as an
 * incoming file's.
 */
export function mergeDive(
  sources: readonly {
    sourceId: string;
    sourceKind: string;
    recordedAt: Date;
    fields: Readonly<Record<string, unknown>>;
    sensedFields?: readonly string[];
  }[],
): MergedDive {
  const paths = new Set<string>();
  for (const source of sources) for (const path of Object.keys(source.fields)) paths.add(path);

  const fields: Record<string, FieldResolution> = {};
  const contestedFields: string[] = [];

  for (const path of [...paths].sort()) {
    const contributions: Contribution[] = sources
      .filter((s) => path in s.fields)
      .map((s) => ({
        sourceId: s.sourceId,
        sourceKind: s.sourceKind,
        recordedAt: s.recordedAt,
        value: s.fields[path],
        ...(s.sensedFields?.includes(path) ? { sensed: true } : {}),
      }));

    const resolution = resolveField(path, contributions);
    if (resolution.provenance.length === 0) continue;
    fields[path] = resolution;
    if (resolution.contested) contestedFields.push(path);
  }

  return { fields, hasContestedFields: contestedFields.length > 0, contestedFields };
}

/** The provenance rows a merge produces, ready to write. */
export function provenanceRows(merged: MergedDive): Provenance[] {
  return Object.values(merged.fields).flatMap((f) => f.provenance);
}

/** The values a dive should show, flattened. */
export function selectedValues(merged: MergedDive): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, resolution] of Object.entries(merged.fields)) {
    if (resolution.value !== undefined) out[path] = resolution.value;
  }
  return out;
}

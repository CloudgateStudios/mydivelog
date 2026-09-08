import { randomUUID } from 'node:crypto';
import {
  matchSite,
  mergeDive,
  selectedValues,
  siteCoordinateUpdate,
  slugify,
  type ExistingSite,
  type MergedDive,
} from '@mydivelog/domain';
import type { PrismaClient } from '../client.ts';
import type { UserScope } from '../scope.ts';

/**
 * Commit and revert.
 *
 * Revert is what makes import safe to try. A diver who knows they can undo
 * will import; one who is not sure will not, and a logbook is a decade of
 * someone's memory. So revert is not a convenience here — it is the feature
 * that makes the rest of the phase usable.
 */

/** What one parsed row asserts, ready to be written. */
export type CommitRow = {
  rowIndex: number;
  /** `merge` requires `diveId`; `create` makes one. */
  decision: 'create' | 'merge' | 'skip';
  diveId?: string;
  sourceKind: string;
  /** The source's own id. Combined with the batch, this is what makes a replay a no-op. */
  sourceRef?: string;
  sourceFileKey?: string;
  rawPayload?: unknown;
  /** When the source captured the dive, not when we read the file. */
  recordedAt: Date;
  fields: Record<string, unknown>;
  profile?: ProfileToStore;
};

export type ProfileToStore = {
  storageKey: string;
  format: string;
  sampleCount: number;
  byteSize: number;
  checksum: string;
  channels: string[];
  maxDepthM: number;
  avgDepthM: number;
  durationS: number;
  intervalS?: number;
  minTempC?: number;
  maxTempC?: number;
};

export type CommitResult = {
  batchId: string;
  created: string[];
  merged: string[];
  skipped: number;
  /** Rows whose source was already attached to this batch. */
  replayed: number;
};

/**
 * Fields that live in columns on `dives`. Everything else is held as
 * provenance only until the entity that owns it exists — sites and tags are
 * shared, deduplicated records rather than columns, so they get their own
 * resolution step rather than being written here.
 */
/**
 * Columns a dive cannot be without, and has no sensible empty value for.
 *
 * Left alone when nothing asserts them: a dive with no start time is not a row
 * worth keeping, and if every source for it is gone the dive is deleted rather
 * than blanked.
 *
 * `tzOffsetMinutes` is deliberately not here even though the column is NOT
 * NULL, because zero is a meaningful value for it — "we do not know the
 * offset" — and treating it as unclearable meant a revert left the offset the
 * removed source had contributed. A dive reverted back to a spreadsheet that
 * records no timezone kept claiming -04:00.
 */
const REQUIRED_COLUMNS = new Set(['startTimeUtc', 'startTimeLocal']);

/** What an unasserted column falls back to, where a default is meaningful. */
const COLUMN_DEFAULTS: Record<string, unknown> = { tzOffsetMinutes: 0 };

const DIVE_COLUMNS = {
  startTimeUtc: 'startTimeUtc',
  startTimeLocal: 'startTimeLocal',
  tzOffsetMinutes: 'tzOffsetMinutes',
  durationS: 'durationS',
  maxDepthM: 'maxDepthM',
  avgDepthM: 'avgDepthM',
  waterTempMinC: 'waterTempMinC',
  airTempC: 'airTempC',
  visibilityM: 'visibilityM',
  weightKg: 'weightKg',
  waterType: 'waterType',
  rating: 'rating',
  notes: 'notes',
} as const;

const INT_COLUMNS = new Set(['tzOffsetMinutes', 'durationS', 'rating']);

/**
 * How long a whole-batch write is allowed to take.
 *
 * Prisma's default is five seconds. Committing ninety-six dives took just
 * under that against a database on localhost and comfortably over it against
 * a managed one, so the import died with P2028 in production and worked
 * everywhere it was tested.
 *
 * Two minutes is generous rather than arbitrary: this is one atomic write of a
 * diver's whole import, and the alternative to waiting is a half-imported
 * logbook. The cost of the ceiling being too low is the failure above; the
 * cost of it being too high is one slow request, which is visible and
 * recoverable. `maxWait` is the time spent trying to get a connection at all,
 * which is a queue problem rather than a size one.
 */
const BATCH_TRANSACTION = { timeout: 120_000, maxWait: 15_000 } as const;

export function createImportRepository(prisma: PrismaClient) {
  return {
    /**
     * Writes a whole batch in one transaction.
     *
     * Idempotent by construction: `unique(importBatchId, sourceRef)` on
     * `DiveSource` means replaying a commit cannot attach the same source
     * twice, so a retried or duplicated request converges rather than
     * duplicating a diver's history.
     */
    async commit(
      scope: UserScope,
      batchId: string,
      rows: readonly CommitRow[],
    ): Promise<CommitResult> {
      return prisma.$transaction(async (tx) => {
        const tags = await loadTags(tx, scope);
        const sites = await loadSites(tx, scope);
        const result: CommitResult = { batchId, created: [], merged: [], skipped: 0, replayed: 0 };

        // Numbers are assigned here because sources frequently carry none —
        // the seed UDDF has none across all 96 dives.
        const highest = await tx.dive.aggregate({
          where: { userId: scope.userId, deletedAt: null },
          _max: { diveNumber: true },
        });
        const numbers = numberRowsChronologically(rows, (highest._max.diveNumber ?? 0) + 1);

        for (const row of rows) {
          if (row.decision === 'skip') {
            result.skipped += 1;
            continue;
          }

          if (row.sourceRef !== undefined) {
            const already = await tx.diveSource.findUnique({
              where: {
                importBatchId_sourceRef: { importBatchId: batchId, sourceRef: row.sourceRef },
              },
            });
            if (already) {
              result.replayed += 1;
              continue;
            }
          }

          let diveId = row.diveId;
          if (row.decision === 'create' || diveId === undefined) {
            diveId = randomUUID();
            await tx.dive.create({
              data: {
                id: diveId,
                userId: scope.userId,
                diveNumber: numbers.get(row.rowIndex) ?? 0,
                // Placeholders: the real values land in the resolution below,
                // which is the only place that decides what a dive shows.
                startTimeUtc: (row.fields['startTimeUtc'] as Date | undefined) ?? new Date(0),
                startTimeLocal: (row.fields['startTimeLocal'] as Date | undefined) ?? new Date(0),
                tzOffsetMinutes: (row.fields['tzOffsetMinutes'] as number | undefined) ?? 0,
              },
            });
            result.created.push(diveId);
          } else {
            const target = await tx.dive.findFirst({
              where: { id: diveId, userId: scope.userId, deletedAt: null },
            });
            // A dive that vanished between review and commit must not
            // resurrect as a silent create under someone else's id.
            if (!target) {
              result.skipped += 1;
              continue;
            }
            result.merged.push(diveId);
          }

          const sourceId = randomUUID();
          await tx.diveSource.create({
            data: {
              id: sourceId,
              diveId,
              importBatchId: batchId,
              sourceKind: row.sourceKind,
              sourceRef: row.sourceRef ?? null,
              sourceFileKey: row.sourceFileKey ?? null,
              rawPayload: (row.rawPayload ?? null) as never,
              recordedAt: row.recordedAt,
            },
          });

          await writeProvenance(tx, diveId, sourceId, {
            ...row.fields,
            // Recorded as an assertion so a revert can take the profile away
            // with the source that brought it. The samples stay in object
            // storage; this is only the fact that this source had one.
            ...(row.profile ? { profile: { sampleCount: row.profile.sampleCount } } : {}),
          });
          if (row.profile) await writeProfile(tx, diveId, row.profile);
          await resolve(tx, scope, diveId, tags, sites);
        }

        await tx.importBatch.update({
          where: { id: batchId },
          data: { status: 'committed', committedAt: new Date() },
        });

        return result;
      }, BATCH_TRANSACTION);
    },

    /**
     * Undoes a batch, leaving everything else exactly as it was.
     *
     * Sources from the batch are removed, every field they touched is
     * re-resolved from what remains, and dives whose only source was this
     * batch are deleted. A dive that pre-existed returns to its prior state
     * rather than to a default — which is why provenance records every
     * assertion rather than only the winning one.
     */
    /**
     * `hooks.inTransaction` runs after the revert and before the commit.
     *
     * It exists for the staff path: `docs/11-roadmap.md` requires every staff
     * action to appear in the audit log, and a revert that owns a two-minute
     * transaction cannot have its audit row written outside it without a
     * window where the change has landed and the record of it has not. Passing
     * the writer in is the only way both land together.
     */
    async revert(
      scope: UserScope,
      batchId: string,
      hooks?: { inTransaction?: (tx: Tx) => Promise<void> },
    ): Promise<{ deleted: string[]; restored: string[] }> {
      return prisma.$transaction(async (tx) => {
        // Revert re-resolves every touched dive, which resolves tags too.
        const tags = await loadTags(tx, scope);
        const sites = await loadSites(tx, scope);
        const batch = await tx.importBatch.findFirst({
          where: { id: batchId, userId: scope.userId },
        });
        if (!batch) throw new Error(`Import batch ${batchId} does not belong to this user.`);

        const sources = await tx.diveSource.findMany({
          where: { importBatchId: batchId },
          select: { id: true, diveId: true },
        });
        const touched = [...new Set(sources.map((s) => s.diveId))];

        // Provenance cascades from the source, so removing sources removes
        // exactly the assertions this batch made and nothing else.
        await tx.diveSource.deleteMany({ where: { importBatchId: batchId } });

        const deleted: string[] = [];
        const restored: string[] = [];

        for (const diveId of touched) {
          const remaining = await tx.diveSource.count({ where: { diveId } });
          if (remaining === 0) {
            await tx.dive.delete({ where: { id: diveId } });
            deleted.push(diveId);
            continue;
          }
          await resolve(tx, scope, diveId, tags, sites);
          restored.push(diveId);
        }

        await tx.importBatch.update({
          where: { id: batchId },
          data: { status: 'reverted', revertedAt: new Date() },
        });

        await hooks?.inTransaction?.(tx);

        return { deleted, restored };
      }, BATCH_TRANSACTION);
    },
  };
}

export type ImportRepository = ReturnType<typeof createImportRepository>;

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Which number each row's new dive gets.
 *
 * By date, not by the order the rows happen to be in. A dive number means
 * "the nth dive I have done", so the oldest dive in a batch takes the lowest
 * number — and a file's row order is no evidence of that. Plenty of exports
 * are newest-first: the sample UDDF is, and numbering by position gave its
 * most recent dive number 1 and its oldest number 6, precisely backwards.
 *
 * Rows are numbered from the diver's current highest, so an import appends.
 * That is right when the file is newer than everything already logged and
 * wrong when it is not — and nothing here can fix that, because it is a fact
 * about the whole logbook rather than about this batch.
 * `numberingIsChronological` in @mydivelog/domain detects it afterwards, and
 * the diver is offered a renumbering rather than given one.
 *
 * A row with no start time sorts last and keeps its relative position, which
 * is the only stable answer when there is nothing to sort on.
 */
function numberRowsChronologically(
  rows: readonly CommitRow[],
  startAt: number,
): Map<number, number> {
  const creating = rows.filter((row) => row.decision === 'create' || row.diveId === undefined);

  const ordered = [...creating].sort((a, b) => {
    const at = (a.fields['startTimeUtc'] as Date | undefined)?.getTime();
    const bt = (b.fields['startTimeUtc'] as Date | undefined)?.getTime();
    if (at === undefined && bt === undefined) return a.rowIndex - b.rowIndex;
    if (at === undefined) return 1;
    if (bt === undefined) return -1;
    // The same instant twice is a repetitive dive logged with only a date;
    // row order is then the diver's own sequence and the best evidence there is.
    return at !== bt ? at - bt : a.rowIndex - b.rowIndex;
  });

  return new Map(ordered.map((row, index) => [row.rowIndex, startAt + index]));
}

async function writeProvenance(
  tx: Tx,
  diveId: string,
  sourceId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const rows = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([fieldPath, value]) => ({
      diveId,
      fieldPath,
      sourceId,
      value: serialize(value) as never,
      isSelected: false,
      confidence: 1,
    }));
  if (rows.length > 0) await tx.diveFieldProvenance.createMany({ data: rows });
}

async function writeProfile(tx: Tx, diveId: string, profile: ProfileToStore): Promise<void> {
  await tx.diveProfile.upsert({
    where: { diveId },
    create: {
      id: randomUUID(),
      diveId,
      storageKey: profile.storageKey,
      format: profile.format,
      sampleCount: profile.sampleCount,
      byteSize: profile.byteSize,
      checksum: profile.checksum,
      channels: profile.channels,
      maxDepthM: profile.maxDepthM,
      avgDepthM: profile.avgDepthM,
      durationS: profile.durationS,
      intervalS: profile.intervalS ?? null,
      minTempC: profile.minTempC ?? null,
      maxTempC: profile.maxTempC ?? null,
    },
    update: {
      storageKey: profile.storageKey,
      sampleCount: profile.sampleCount,
      byteSize: profile.byteSize,
      checksum: profile.checksum,
    },
  });
  await tx.dive.update({ where: { id: diveId }, data: { hasProfile: true } });
}

/**
 * Recomputes what a dive shows from every source still attached to it.
 *
 * Deliberately re-derived from scratch rather than applied incrementally. An
 * incremental update cannot undo itself, and revert is exactly the operation
 * that needs the answer to be a function of what remains rather than of the
 * order things arrived in.
 *
 * Every managed column is written on every pass, including to null. Writing
 * only the fields that have values is the natural way to do this and it is
 * wrong: after a revert the dive keeps whatever the removed source had
 * contributed alone, so the record still claims a duration nothing measured.
 */
async function resolve(
  tx: Tx,
  scope: UserScope,
  diveId: string,
  tags: Map<string, string>,
  sites: ExistingSite[],
): Promise<void> {
  const sources = await tx.diveSource.findMany({
    where: { diveId },
    include: { provenance: true },
  });

  const merged: MergedDive = mergeDive(
    sources.map((source) => ({
      sourceId: source.id,
      sourceKind: source.sourceKind,
      recordedAt: source.recordedAt,
      fields: Object.fromEntries(
        source.provenance.map((p) => [p.fieldPath, deserialize(p.fieldPath, p.value)]),
      ),
      sensedFields: SENSED_BY_KIND[source.sourceKind] ?? [],
    })),
  );

  const values = completeTimes(selectedValues(merged));
  const data: Record<string, unknown> = { hasContestedFields: merged.hasContestedFields };

  for (const [path, column] of Object.entries(DIVE_COLUMNS)) {
    const value = values[path];
    if (value === undefined) {
      // Cleared, not skipped. A field whose only source has been reverted has
      // to go back to empty, or revert leaves the value behind and the dive
      // claims a duration nothing measured. Skipping here passed every test
      // except the one that mattered.
      if (!REQUIRED_COLUMNS.has(path)) {
        data[column] = path in COLUMN_DEFAULTS ? COLUMN_DEFAULTS[path] : null;
      }
      continue;
    }
    data[column] = INT_COLUMNS.has(column) ? Math.round(Number(value)) : value;
  }
  // Sites and tags are shared, deduplicated entities rather than columns, so
  // they resolve here too — inside the same recomputation, which is what makes
  // revert undo them as exactly as it undoes a scalar.
  data['siteId'] = await resolveSite(tx, scope, values, sites);
  await tx.dive.update({ where: { id: diveId }, data: data as never });
  await resolveTags(tx, scope, diveId, values['tags'], tags);

  // Mark which assertion each field is currently showing, so the UI can say
  // where a value came from without recomputing the merge.
  const selectedBySource = new Map<string, Set<string>>();
  for (const resolution of Object.values(merged.fields)) {
    for (const p of resolution.provenance) {
      if (!p.isSelected) continue;
      const set = selectedBySource.get(p.sourceId) ?? new Set<string>();
      set.add(p.fieldPath);
      selectedBySource.set(p.sourceId, set);
    }
  }

  // A profile belongs to the source that brought it. Without this, reverting
  // the import that supplied one leaves the dive claiming a depth profile it
  // no longer has, pointing at a blob nothing references.
  const stillHasProfile = sources.some((source) =>
    source.provenance.some((row) => row.fieldPath === 'profile'),
  );
  if (!stillHasProfile) {
    await tx.diveProfile.deleteMany({ where: { diveId } });
    await tx.dive.update({ where: { id: diveId }, data: { hasProfile: false } });
  }

  await tx.diveFieldProvenance.updateMany({ where: { diveId }, data: { isSelected: false } });
  for (const [sourceId, paths] of selectedBySource) {
    await tx.diveFieldProvenance.updateMany({
      where: { diveId, sourceId, fieldPath: { in: [...paths] } },
      data: { isSelected: true },
    });
  }
}

/**
 * Fills in whichever of the three time fields the sources did not assert.
 *
 * A spreadsheet records a wall clock and no timezone, so nothing asserts
 * `startTimeUtc` — and the row keeps the epoch placeholder it was created
 * with. Every dive imported from a spreadsheet was stored as 1970-01-01 UTC:
 * the local time displayed correctly, so a logbook looked right while sorting
 * by time, surface intervals and any UTC-bounded query were all wrong.
 *
 * With no offset to go on, local is used as UTC. That is a guess, and it is
 * the guess the schema already forces by requiring all three columns — but it
 * is at least self-consistent and it sorts. The offset stays unasserted, so
 * the admin panel shows it as assumed rather than as something a source said.
 */
function completeTimes(values: Record<string, unknown>): Record<string, unknown> {
  const local = values['startTimeLocal'];
  const utc = values['startTimeUtc'];
  const offset = values['tzOffsetMinutes'];
  const minute = 60_000;

  if (local instanceof Date && !(utc instanceof Date)) {
    return {
      ...values,
      startTimeUtc:
        typeof offset === 'number' ? new Date(local.getTime() - offset * minute) : local,
    };
  }
  if (utc instanceof Date && !(local instanceof Date) && typeof offset === 'number') {
    return { ...values, startTimeLocal: new Date(utc.getTime() + offset * minute) };
  }
  return values;
}

/** Which fields an instrument measured rather than was told. */
const SENSED_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  uddf: ['gases', 'profile', 'waterTempMinC'],
};

/** Dates do not survive a JSON round trip, so they are tagged going in. */
const DATE_PREFIX = '@date:';

function serialize(value: unknown): unknown {
  if (value instanceof Date) return `${DATE_PREFIX}${value.toISOString()}`;
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

function deserialize(_fieldPath: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(DATE_PREFIX)) {
    return new Date(value.slice(DATE_PREFIX.length));
  }
  if (Array.isArray(value)) return value.map((v) => deserialize(_fieldPath, v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, deserialize(_fieldPath, v)]),
    );
  }
  return value;
}

/**
 * Finds or creates the site a dive belongs to.
 *
 * Only the diver's own sites are considered. The shared site database is
 * seeded by promoting well-attested private sites, not by letting one
 * person's import silently attach to a stranger's record — a name like
 * `Blue Hole` would otherwise merge four continents into one place.
 */
/**
 * Every site this diver owns, read once for the whole batch.
 *
 * This was a findMany with its aliases joined, executed once per dive — a full
 * scan of the diver's sites ninety-six times over for one import, and growing
 * as the import created more. Together with the same mistake in tag lookup it
 * is most of what pushed a commit past its transaction budget.
 *
 * The list is kept current in memory as sites are created, located and
 * aliased, so matching sees exactly what a re-read would have shown. Nothing
 * outside this transaction can change it while it is open.
 */
async function loadSites(tx: Tx, scope: UserScope): Promise<ExistingSite[]> {
  const owned = await tx.site.findMany({
    where: { ownerUserId: scope.userId, deletedAt: null },
    include: { aliases: true },
  });
  return owned.map((site) => ({
    id: site.id,
    name: site.name,
    ...(site.latitude === null ? {} : { lat: site.latitude }),
    ...(site.longitude === null ? {} : { lon: site.longitude }),
    ...(site.regionId === null ? {} : { regionId: site.regionId }),
    aliases: site.aliases.map((a) => a.name),
  }));
}

async function resolveSite(
  tx: Tx,
  scope: UserScope,
  values: Record<string, unknown>,
  sites: ExistingSite[],
): Promise<string | null> {
  const name = typeof values['site.name'] === 'string' ? values['site.name'] : undefined;
  const lat = typeof values['site.lat'] === 'number' ? values['site.lat'] : undefined;
  const lon = typeof values['site.lon'] === 'number' ? values['site.lon'] : undefined;
  if (name === undefined && lat === undefined) return null;

  const candidates: ExistingSite[] = sites;

  const match = matchSite(
    {
      ...(name === undefined ? {} : { name }),
      ...(lat === undefined ? {} : { lat }),
      ...(lon === undefined ? {} : { lon }),
    },
    candidates,
  );

  if (match) {
    const existing = sites.find((site) => site.id === match.siteId);
    if (existing) {
      // A site the spreadsheet named gains the watch's coordinates here. This
      // is the moment a site becomes both named and located.
      const coords = siteCoordinateUpdate(
        {
          ...(existing.lat === undefined ? {} : { lat: existing.lat }),
          ...(existing.lon === undefined ? {} : { lon: existing.lon }),
        },
        { ...(lat === undefined ? {} : { lat }), ...(lon === undefined ? {} : { lon }) },
      );
      if (coords) {
        await tx.site.update({
          where: { id: existing.id },
          data: { latitude: coords.lat, longitude: coords.lon },
        });
        // Kept in step, so the next dive in this batch matches against the
        // coordinates this one just gave it.
        existing.lat = coords.lat;
        existing.lon = coords.lon;
      }
      // Every spelling seen becomes an alias, which is how `1,000 Steps`,
      // `Thousand Steps` and `1000 Steps` converge instead of being guessed
      // at again on every import.
      if (name !== undefined && slugify(name) !== slugify(existing.name)) {
        await tx.siteAlias.upsert({
          where: { siteId_name: { siteId: existing.id, name } },
          create: { id: randomUUID(), siteId: existing.id, name, source: 'import' },
          update: {},
        });
        if (!existing.aliases?.includes(name))
          existing.aliases = [...(existing.aliases ?? []), name];
      }
    }
    return match.siteId;
  }

  const id = randomUUID();
  const created = {
    id,
    // A dive computer's site has coordinates and no name worth keeping, so it
    // gets a placeholder a human can rename rather than an opaque id.
    name: name ?? 'Unnamed site',
    ownerUserId: scope.userId,
    isPublic: false,
    latitude: lat ?? null,
    longitude: lon ?? null,
  };
  await tx.site.create({ data: created });
  sites.push({
    id,
    name: created.name,
    ...(lat === undefined ? {} : { lat }),
    ...(lon === undefined ? {} : { lon }),
    aliases: [],
  });
  return id;
}

/**
 * Attaches the dive's tags, creating user tags for anything the seeded
 * taxonomy does not cover.
 *
 * Replaces rather than adds: like every other field, a dive's tags are a
 * function of its surviving sources, so a revert removes the ones that batch
 * contributed without touching the rest.
 */
/**
 * Every tag this commit could possibly match, read once.
 *
 * The taxonomy is the same twenty-six rows for every dive in a batch, and it
 * was being looked up once per tag per dive — around five hundred sequential
 * queries for a ninety-six dive import, inside a transaction with a five
 * second budget. Against a database on localhost that fit; against a managed
 * one it did not, and the commit died with P2028 while the button quietly
 * went back to how it started.
 *
 * System tags are shared and a diver's own are theirs, so both are safe to
 * hold for the length of one transaction: nothing else can add to either set
 * while it is open.
 */
async function loadTags(tx: Tx, scope: UserScope): Promise<Map<string, string>> {
  const rows = await tx.tag.findMany({
    where: { OR: [{ isSystem: true }, { userId: scope.userId }] },
    select: { id: true, slug: true, isSystem: true },
  });

  const bySlug = new Map<string, string>();
  // The diver's own first, then let a system tag win: `resolveTags` preferred
  // the shared taxonomy, and this has to keep preferring it.
  for (const tag of rows.filter((t) => !t.isSystem)) bySlug.set(tag.slug, tag.id);
  for (const tag of rows.filter((t) => t.isSystem)) bySlug.set(tag.slug, tag.id);
  return bySlug;
}

async function resolveTags(
  tx: Tx,
  scope: UserScope,
  diveId: string,
  value: unknown,
  tags: Map<string, string>,
): Promise<void> {
  const names = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  const tagIds: string[] = [];
  for (const name of names) {
    const slug = slugify(name);
    if (slug === '') continue;

    const known = tags.get(slug);
    if (known) {
      tagIds.push(known);
      continue;
    }

    // Genuinely new. Created once and remembered, so the next dive in the same
    // batch that mentions it costs nothing.
    const created = await tx.tag.create({
      data: {
        id: randomUUID(),
        slug,
        label: name.trim(),
        category: 'activity',
        isSystem: false,
        userId: scope.userId,
      },
    });
    tags.set(slug, created.id);
    tagIds.push(created.id);
  }

  await tx.diveTag.deleteMany({ where: { diveId } });
  if (tagIds.length > 0) {
    await tx.diveTag.createMany({
      data: [...new Set(tagIds)].map((tagId) => ({ diveId, tagId })),
    });
  }
}

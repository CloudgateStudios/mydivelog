# Import & Merge Engine

This is the product. Everything else is a logbook UI that a dozen apps already have.

## Pipeline

```
  upload
    │
    ▼
┌─────────────┐  file stored in object storage, checksummed
│  1 INGEST   │  identical re-upload → short-circuit to existing batch
└─────┬───────┘
      ▼
┌─────────────┐  sniff content, not extension: XML root/namespace, SQLite magic,
│  2 DETECT   │  FIT header, zip+sheet structure. Unknown → generic tabular mapper.
└─────┬───────┘
      ▼
┌─────────────┐  format-specific parser → DiveObservation[]
│  3 PARSE    │  pure function, no DB. Errors are per-row, never fatal for the batch.
└─────┬───────┘
      ▼
┌─────────────┐  units → SI, timezone repair, taxonomy fuzzy-match, sentinel stripping.
│ 4 NORMALIZE │  every change recorded in normalizations[]
└─────┬───────┘
      ▼
┌─────────────┐  score each observation against existing dives → create | merge | ambiguous
│  5 MATCH    │
└─────┬───────┘
      ▼
┌─────────────┐  human confirms. High-confidence decisions pre-selected, all overridable.
│  6 REVIEW   │
└─────┬───────┘
      ▼
┌─────────────┐  one transaction. Writes dives, sources, provenance, profiles.
│  7 COMMIT   │  idempotent — safe to retry.
└─────┬───────┘
      ▼
┌─────────────┐  revert available indefinitely; removes sources and re-resolves fields
│  8 REVERT   │
└─────────────┘
```

Stages 3–5 are pure and independently testable. Only 1, 7 and 8 do I/O.

## The Intermediate Representation

Every importer produces the same thing. Adding a format means writing one function to this
shape and nothing else.

```ts
type DiveObservation = {
  sourceRef?: string          // the source's own id, for idempotent re-import
  sourceKind: string

  startTime: { utc?: Date; local?: Date; offsetMinutes?: number; raw: string }
  durationS?: number
  maxDepthM?: number
  avgDepthM?: number

  site?: { name?: string; lat?: number; lon?: number; regionHint?: string }
  tags?: string[]             // pre-taxonomy, as the source wrote them
  gases?: { o2Fraction: number; heFraction?: number; label?: string }[]
  tanks?: { volumeL?: number; startBar?: number; endBar?: number; gasIndex?: number }[]
  gear?: { raw: string; parsed?: GearGuess[] }
  buddies?: string[]

  waterTempMinC?: number
  airTempC?: number
  visibilityM?: number
  weightKg?: number
  waterType?: 'fresh' | 'salt' | 'brackish'
  diveMode?: string
  rating?: number
  notes?: string
  diveNumber?: number

  profile?: ProfileSeries     // channels + samples, already in SI

  raw: unknown                // untouched source representation, always kept
  issues: Issue[]
}
```

Two invariants:

- **`raw` is never dropped.** If parsing missed something, it can be recovered later without
  asking the diver to re-upload.
- **Absent means absent.** A field the source didn't provide is `undefined`, never `0`,
  never `""`. See the `leadquantity` trap below.

## Normalization Rules

### Units
Per-format, declared not inferred. UDDF is SI with kelvin temperatures; the workbook is
imperial with Excel date serials and day fractions. Conversions live in
`packages/domain/units` and are tested exhaustively — a wrong constant here silently
corrupts an entire history.

### Timezone repair
The observed exporter bug (`-00:04` meaning −04:00) generalizes into a rule:

```
if |offsetMinutes| < 60 and offsetMinutes % 60 != 0:
    suspect = true
    if site has coordinates:
        derived = tz offset at (lat, lon, localDate)
        if derived / 60 == -offsetMinutes:      # -00:04 vs -04:00
            correct to derived, record normalization, confidence: high
        else:
            flag for review, confidence: low
    else:
        flag for review
```

Corrections are **always recorded and always visible**, never silent. The original value
stays on `ImportRow.raw` and in `DiveSource.rawPayload` forever.

### Sentinel stripping
Per-format lists of values that mean "absent":

| Format | Sentinel | Field |
|---|---|---|
| UDDF (Oceanic+) | `leadquantity = 0.0` on every dive | weight → `undefined` |
| UDDF (Oceanic+) | `name == id` (`site_69ab…`) | site name → `undefined`, keep coords |
| Spreadsheet | `"N/A"`, `""`, `"-"`, `"?"` | any |
| Various | altitude outside −50..6000 m | altitude → `undefined` + issue |

The `leadquantity` case is the instructive one: the file says `0.0` for all 96 dives while
the diver's spreadsheet says 16–24 lbs. Importing `0.0` as a measurement would let a
worthless value out-rank a real one during merge.

### Taxonomy matching
`"Boat, Dift, Sunset"` → split (quote-aware) → trim → fuzzy-match each token against the
seeded tag taxonomy.

- exact slug match → apply
- edit distance ≤ 2 to a system tag (`Dift` → `drift`) → propose with the original shown
- no match → propose a new user tag

Proposals are confirmed once per batch, not once per row — the diver answers "`Dift` means
`drift`?" a single time for all 39 rows.

### Derived-column detection
Spreadsheets carry rollups. `Running Total Time` is a cumulative formula, `Time Out` is
`Time In + Dive Time`. The mapper flags columns that are exact functions of others and
defaults them to "ignore," because importing a rollup as a field is worse than dropping it.

## Matching

The heart of it. Given a normalized observation, is this a dive we already have?

### Candidate selection
Pull existing dives for the user where `|start_time_utc - obs.startTimeUtc| <= 6 hours`.
Wide, because the timezone of an incoming record may itself be wrong.

### Scoring

| Signal | Weight | Notes |
|---|---|---|
| Start time within ±5 min | 0.45 | The dominant signal |
| Start time within ±90 min, same local date | 0.25 | Covers offset/rounding error |
| Same local date only | 0.10 | Weak alone |
| Max depth within 5% or 1 m | 0.20 | 46 ft vs 14.099 m ✓ |
| Duration within 10% or 3 min | 0.15 | |
| Site within 500 m, or name similarity > 0.8 | 0.15 | |
| Same gas mix (±1% o2) | 0.05 | |
| Same `sourceRef` already on the dive | **1.00** | Exact re-import — deterministic |

Thresholds:

- **≥ 0.80 → auto-merge**, pre-selected in review, one click to undo
- **0.45–0.79 → ambiguous**, presented side-by-side, no default
- **< 0.45 → create new**

Never auto-merge on date alone. A diver doing five dives in one day in Bonaire will have
five records with the same date, similar depths and similar durations; time-of-day is what
separates them, and it is exactly what a broken timezone destroys. When the offset is
flagged suspect, the auto-merge threshold is raised and the rows go to review regardless of
score.

**One-to-one constraint:** within a batch, an existing dive can receive at most one
observation. Two observations both scoring high against one dive is itself a signal — it
means the source has duplicates or the times are wrong. Both go to review.

### Site matching
Separate from dive matching and runs first, because a resolved site improves dive scores.

1. Exact coordinates within 50 m → same site
2. Within 250 m **and** name similarity > 0.6 → same site
3. Name exact match (case/punctuation-insensitive, alias-aware) within the same region → same site
4. Otherwise → new private site

`1,000 Steps` / `Thousand Steps` / `1000 Steps` resolve via `SiteAlias`, which is populated
as imports encounter variants.

## Field-Level Merge

When an observation merges onto an existing dive, each field is resolved independently.

### Source precedence

```
instrument  >  manual  >  file_import  >  derived
```

but **per field class**, not globally:

| Field class | Fields | Preferred source | Reasoning |
|---|---|---|---|
| Measured | depth, duration, temperature, pressure, profile | instrument | The computer was there and doesn't round |
| Subjective | notes, rating, visibility, buddies | manual / human-authored | A watch has no opinion |
| Identifying | site name, trip, dive number | manual | Computers emit opaque ids |
| Configured | gas, tank size, weight, gear | manual, unless instrument-sensed | Divers configure these by hand |
| Geographic | lat/lon, altitude | instrument | GPS beats memory |

Applied to the worked example: the merged dive takes **14.099 m** (instrument) for depth,
**"Angel City"** (spreadsheet) for site name, **12.10°N 68.29°W** (instrument) for coords,
**EAN 33** (instrument, sensed) for gas with the spreadsheet's EAN 32 retained and flagged,
the spreadsheet's notes and weight, and the instrument's 208-sample profile.

That single merged record is better than either source. That is the demo.

### Rules
1. A field with a value never loses to a field without one, regardless of precedence.
2. Equal precedence → most recently recorded wins.
3. Conflicting values at equal precedence → **both retained**, one selected, dive flagged
   `hasContestedFields`. Surfaced in the UI, not buried.
4. Notes never overwrite. They **append** with source attribution.
5. Every resolution writes a `DiveFieldProvenance` row.

Rule 4 matters: notes are irreplaceable and unmergeable. Concatenating with a source label
is imperfect but never destroys anything.

## Commit & Revert

**Commit** runs in one transaction per batch (chunked for very large files, each chunk
atomic and resumable). Idempotency comes from `unique(importBatchId, sourceRef)` on
`DiveSource` — replaying a commit cannot duplicate. Profiles upload to object storage
*before* the transaction; orphaned blobs are cheaper than missing ones and a sweeper cleans
them up.

**Revert** must remain available indefinitely. It deletes the batch's `DiveSource` rows,
then for every affected field re-resolves from remaining provenance. Dives whose only source
was this batch are deleted. Dives that pre-existed return to their prior state.

Revert is what makes import safe to try. A diver who knows they can undo will import; one
who isn't sure won't.

## Format Roadmap

| Tier | Format | Notes |
|---|---|---|
| **1 — v1** | **UDDF 3.x** | Open standard, widest support. Expect vendor deviations. |
| | **CSV / XLSX via mapping UI** | Covers the infinite tail. Templates are shareable. |
| | **Subsurface XML** | Open, well-documented, the enthusiast's tool. Its users are exactly the consolidators. |
| | **MyDiveLog JSON** | Own format, full fidelity, round-trip guaranteed. |
| **2 — post-launch** | Garmin FIT | Big installed base. Binary; use a maintained FIT parser. |
| | Shearwater Cloud export | Technical divers, high-value users. SQLite. |
| | Suunto SDE/XML, Mares, Scubapro LogTRAK | Vendor XML variants |
| | DAN / DL7 | Dive medicine and research |
| **3 — later** | Garmin Connect API, Diviac, Deepblu, MacDive | OAuth integrations, continuous sync |
| | Direct BLE from dive computers | Per-vendor reverse engineering; large project |
| | Paper log OCR | Photograph a page → structured dive. Genuinely valuable for pre-2010 history. |

Every importer ships with a fixture file and a snapshot test. **No importer merges without
a real-world sample file committed to `fixtures/`.**

## Export

Export parity is a stated product promise, so it gets first-class treatment, not an
afterthought endpoint.

| Format | Fidelity | Purpose |
|---|---|---|
| MyDiveLog JSON | Complete — including provenance and sources | Backup, migration, round-trip test |
| UDDF 3.2 | High — profiles, sites, gases | Interop with other tools |
| CSV / XLSX | Flat summary, one row per dive | Spreadsheet people, and there are many |
| PDF logbook | Formatted, printable, signature lines | The thing divers actually want to show people |
| Subsurface XML | High | Escape hatch to the open-source tool |

**Round-trip test in CI:** export a fixture logbook to MyDiveLog JSON, re-import into a
clean database, assert deep equality. If that test can't pass, the data model has a hole.

## Testing Strategy

1. **Golden fixture (the key test).** The real workbook + real UDDF, merged, verified by
   hand once, committed as an expected snapshot. Every engine change runs against it.
2. **Unit tests on `packages/domain`** — units, timezone repair, scoring, merge precedence.
   Pure functions, milliseconds.
3. **Property tests** — for any observation set, committing twice equals committing once;
   commit-then-revert restores the prior state exactly.
4. **Per-format fixtures** — one real file per supported format, minimum.
5. **Adversarial fixtures** — empty file, one row, 10k dives, wrong encoding, truncated XML,
   a spreadsheet with merged header cells, a UDDF with no sites. Each must fail *gracefully*
   with a per-row issue, never a 500 and never a partial write.

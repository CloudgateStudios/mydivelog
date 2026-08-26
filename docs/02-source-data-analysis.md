# Source Data Analysis

Findings from the two real files supplied as seed data. Everything in the data model and
the import engine traces back to something in this document. These are not hypotheticals —
each is an observed property of real dive data.

## The Files

| | `Dive Log.xlsx` | `…uddf` (Oceanic+ export) |
|---|---|---|
| Dives | 197 rows | 96 dives |
| Date range | 2012-06-02 → 2026-03-06 | 2023-02-26 → 2026-03-06 |
| Units | feet, °F, lbs | metres, **kelvin**, seconds |
| Depth profile | none | 20,014 waypoints @ 15s |
| Site identity | free text name | opaque id + lat/long, **no human name** |
| Notes / gear / buddy | yes | none |
| Tank pressure | no | no |
| Size | 95 KB | 4.6 MB |

## Finding 1 — The Files Overlap. This Is The Whole Product.

The spreadsheet covers 2012–2026. The UDDF covers 2023–2026. Roughly **92–96 dives exist
in both files**, each holding fields the other lacks.

Worked example, the most recent dive in each file:

| Field | Spreadsheet row #195 | UDDF `dive_69ab7a96…` |
|---|---|---|
| Date/time | 2026-03-06 | 2026-03-06T19:07:42 |
| Max depth | 46 ft | 14.099043 m (= 46.26 ft) |
| Duration | (day fraction) | 2776 s |
| Site | Bonaire → **Angel City** | `site_69ab7a96…`, 12.10°N 68.29°W |
| Gas | EAN 32 | o2 0.33 |
| Profile | — | 208 waypoints |
| Notes / gear / weight | yes | — |

Same dive. Two partial records. A naive importer produces 293 dives, ~96 of them
duplicates, and the diver abandons the product on day one.

**Requirement:** the canonical unit is a *dive*, and a dive has *many sources*. Import
resolves observations onto dives; it does not create rows.

Note also that the two sources disagree slightly on max depth (46 vs 46.26 ft) and that
gas disagrees outright (EAN 32 vs o2 0.33 → EAN 33). Both are typical: the human rounded,
and the dive computer recorded what the analyzer actually read. Neither is "wrong" and the
merge must record both rather than pick silently.

## Finding 2 — Real Export Files Contain Bugs You Must Absorb

Every UDDF timestamp in the sample carries a malformed UTC offset:

```
<datetime>2026-03-06T19:07:42.000-00:04</datetime>
```

Offsets observed across the file: `-00:04` (70 dives), `-00:06` (23), `-00:05` (3). These
are not four-minute offsets. The exporter wrote the offset **hours into the minutes
field** — the true values are −04:00 (Bonaire/Atlantic), −06:00, −05:00.

A conforming XML date parser accepts this happily and every dive lands 4–6 hours off. Dive
times shift across midnight, dives sort into the wrong day, and surface intervals between
repetitive dives become nonsense.

**Requirements:**
- Parsers must **validate semantics, not just syntax**. A rule flags any offset where
  `|offset| < 60min and offset % 60 != 0` as suspect.
- Every dive stores `start_time_utc`, `start_time_local`, and `tz_offset_minutes`
  separately. A dive's local time is the one the diver remembers, and it must survive
  independent of any timezone-derivation logic.
- When a site has coordinates, the timezone can be derived from geography and used to
  **corroborate or correct** a suspect offset. Bonaire at 12.10°N 68.29°W is AST/−04:00,
  which confirms `-00:04` means `-04:00`.
- A corrected value is recorded as a normalization event on the import, visible to the
  diver, never a silent rewrite.

**Design consequence:** the import pipeline needs a `normalizations[]` channel per row —
"we changed this, here's why" — surfaced in the review UI. Assume every format you support
has at least one bug like this in the wild.

## Finding 3 — Human Spreadsheets Are Not Databases

Observed in the workbook:

| Property | Evidence | Consequence |
|---|---|---|
| Dive numbers aren't keys | Two rows numbered `x`; 196 distinct values across 197 rows | Dive number is a **user-assigned display ordinal**, not an identifier. It must renumber on insert. Never key on it. |
| Dates are serials | `41062.0` = 2012-06-02 | Epoch-aware parsing; watch the 1900 vs 1904 workbook epochs |
| Times are day fractions | `0.41180555` = 09:53 | Must combine with the date column to make a timestamp |
| Nulls are strings | `Dive Site` = `N/A` in 40+ rows | Configurable null-token list per import |
| Multi-value columns | `Dive Type` = `"Boat, Dift, Sunset"` — 16 combinations from 8 base values | Split into a tag set, not an enum |
| Typos become taxonomy | `Dift` (drift) appears in 39 rows | Fuzzy-match to a seeded taxonomy, propose the correction, let the user confirm |
| Delimiters appear in values | Site `1,000 Steps` | Never naively split on comma; quote-aware parsing, and prefer explicit list columns |
| Sparse columns | Air temp filled 33/197; EAN% 116/197; notes 101/197 | Nullable everywhere. Absence is data, not zero. |
| Rollups are embedded | `Running Total Time` is a cumulative formula | Derived columns must be detected and dropped, not imported as fields |
| Gear is a joined string | `"Full Wet Suit (5mil Rental), Boots (5mil Rental)"` — 14 distinct combos | Parse into structured gear items with a rental flag; keep raw text as fallback |

The `Lists` sheet is also informative: the diver had already built themselves a controlled
vocabulary for Location, Gas, Water Type, Dive Type and Gear. **Divers want taxonomy.**
Ship a good seeded one and let them extend it.

## Finding 4 — Dive Computer Sites Have No Names

Every UDDF site is `site_69ab7a96dce6e40c7d3abe65` — an opaque id repeated as both `id` and
`name`, with coordinates and an altitude. The watch knows where you were; it has no idea
what the place is called. Meanwhile the spreadsheet has `Angel City` and no coordinates.

Merging the two produces a site that is *both* named and located — which is exactly the
value proposition, and also how the shared site database gets seeded.

Two more wrinkles in that data:
- `altitude` ranges from `-196.0` to `+4.59`. A negative altitude for a sea-level dive site
  is the watch reporting a barometric artifact. **Do not use altitude to infer altitude-dive
  status without sanity bounds.**
- Sites 200 m apart are separate records because each dive created a fresh site. Site
  deduplication needs **geographic clustering** (~150–250 m radius) plus name matching, not
  exact matching.

## Finding 5 — Profile Data Dominates Storage

20,014 waypoints for 96 dives — ~208 per dive at 15-second intervals, each with depth,
elapsed time, and temperature. The UDDF file is **48× larger than the spreadsheet for half
as many dives**.

Extrapolated: a 500-dive diver with modern computers is ~150k waypoints. 10,000 such divers
is ~1.5 billion rows if stored naively as one row per sample.

Sampling also gets denser: 15s here, but Shearwater defaults to 10s and some computers log
at 1–2s, a 7–15× multiplier.

**Requirement:** time-series profiles do not belong in the relational tables as one row per
sample. They are written once, read whole, and never queried field-by-field — see
[Data Model § Profile Storage](./04-data-model.md#profile-storage).

Summary values *derived* from the profile (max depth, mean depth, duration, min/max temp,
ascent-rate violations) do belong in Postgres, denormalized onto the dive, because those
are what searches, sorts and stats need.

## Finding 6 — Sparse, Optional, Sometimes Absent Entirely

Fields present in one source and absent in the other, in both directions:

- UDDF has no notes, no buddy, no visibility, no site name, no tank pressure, and
  `leadquantity` is `0.0` for every dive (unset, not "zero weight" — the diver's spreadsheet
  says 16–24 lbs)
- The spreadsheet has no coordinates, no profile, no per-dive water temperature curve, and
  `rating` exists only in UDDF and only on 22 of 96 dives

**`0.0` from a source that always writes `0.0` is not a measurement.** The importer needs
per-format knowledge of which sentinel values mean "absent." This is unavoidably manual,
per-format work, and it is where import quality actually lives.

## What This Analysis Locks In

1. Dive ↔ many sources, with **field-level provenance**. Not negotiable.
2. Canonical **SI storage**, display-time unit conversion.
3. **Three time fields** per dive: UTC, local, offset.
4. Profiles stored as **compressed blobs outside Postgres**, with derived summaries inside.
5. Sites are **shared, geo-clustered, alias-carrying** entities.
6. Import is a **staged pipeline with human review**, never a direct write.
7. Dive number is an **ordinal**, never a key. Dive identity is `(user, time, ±tolerance)`.
8. Every import is **reversible**.

## Reference Fixture

Both files are checked into `fixtures/` (gitignored if they contain personal data;
a redacted variant is committed). They become the **golden fixture** for the merge engine:
the merged result is verified by hand exactly once, committed as an expected snapshot, and
every future change to the import engine is tested against it.

This is the single highest-value test in the project.

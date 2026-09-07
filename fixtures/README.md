# Fixtures

Test data for the import and merge engine.

## What's here

| File                     | Source                                          | Purpose                                        |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------- |
| `spreadsheet-sample.csv` | Redacted from a real 197-row dive log           | Generic tabular importer, column mapping       |
| `spreadsheet-sample.xlsx`| The same rows, as Excel wrote them              | Workbook reader: sparse cells, formulas, sheets|
| `uddf-sample.uddf`       | Redacted from a real Oceanic+ UDDF 3.2.1 export | UDDF importer, profile decoding                |
| `expected/merged.json`   | Hand-verified, then generated                   | Golden snapshot of the merged result           |

## Redaction

The originals are one diver's real history. Dive sites plus timestamps reveal
home location and travel patterns — see `docs/10-security-privacy.md` — so the
committed fixtures are reduced and shifted:

- Only the overlapping window is kept, plus a few non-overlapping dives on each
  side, so merge behavior is still exercised
- Waypoint series are downsampled and truncated
- Coordinates are offset by a fixed vector, preserving relative geometry (so
  site clustering still works) while not identifying real locations. **The
  shift must also land in a zone with the same UTC offset as the real sites**
  — see below

**Every data hazard is preserved deliberately.** These are not defects in the
fixtures — they are the reason the fixtures exist:

| Hazard                                          | Where                    |
| ----------------------------------------------- | ------------------------ |
| Malformed UTC offsets (`-00:04` meaning −04:00) | `uddf-sample.uddf`       |
| Sentinel `leadquantity` of `0.0` on every dive  | `uddf-sample.uddf`       |
| Site name identical to opaque site id           | `uddf-sample.uddf`       |
| Dive number `x`                                 | `spreadsheet-sample.csv` |
| `N/A` used as a null                            | `spreadsheet-sample.csv` |
| Typo `Dift` for drift                           | `spreadsheet-sample.csv` |
| Comma inside a value (`1,000 Steps`)            | `spreadsheet-sample.csv` |
| Multi-value tag column                          | `spreadsheet-sample.csv` |
| Excel date serials and day fractions            | `spreadsheet-sample.csv` |
| Derived/rollup column                           | `spreadsheet-sample.csv` |
| Sparse rows — omitted cells, not blank ones     | `spreadsheet-sample.xlsx` |
| Formula cells carrying a cached value           | `spreadsheet-sample.xlsx` |
| Trailing rows holding a style and no value      | `spreadsheet-sample.xlsx` |
| A cell typed outside the table, with no heading | `spreadsheet-sample.xlsx` |

Do not "clean up" these files. A fixture that parses easily tests nothing.

### The coordinate shift carries a second constraint

An earlier shift moved the sites from a −04:00 zone into −03:00. Relative
geometry was preserved and site clustering behaved identically, so nothing
looked wrong — but it silently disabled the most important test in the
fixture.

The malformed `-00:04` offsets can only be repaired when geography
independently agrees. With the coordinates in −03:00, a resolver looking them
up correctly refused to confirm −04:00, so the repair path had no end-to-end
coverage with a real timezone lookup at all. The golden snapshot passed
throughout, because it stubs the resolver.

If you change `LAT_SHIFT` or `LON_SHIFT` in `scripts/redact.mjs`, check the
resulting offset as well as the geometry.

## The workbook

`spreadsheet-sample.xlsx` is the same 24 dives as the CSV, in the file format
they actually arrived in. It is built from the real workbook rather than
written from scratch, because the properties that make a workbook hard to read
are not properties anybody would think to invent:

- **Rows are sparse.** Excel omits an empty cell rather than writing a blank
  one, so a row runs `A,B,C,D,G,I` with E, F and H simply absent — 177 of the
  original's 197 rows do this. A reader that takes cells in document order
  shifts every later value one column left, with no error at all: a max depth
  lands in "time out" and the logbook is quietly wrong.
- **Formulas carry their last value.** The derived "Time Out" and "Running
  Total Time" columns are formulas; 378 cells in the original. The cached value
  beside the formula is the data, and nothing should try to evaluate anything.
- **Trailing rows are not empty.** Excel pads with `<c r="K1000" s="2"/>` — a
  style and no value — across 802 rows. Treating "this row has cells" as "this
  row has data" turns every one of them into a dive. The first version of the
  generator script made exactly that mistake.
- **One cell sits outside the table**, a column past the last heading with no
  heading of its own. It must be reported and never imported.

Regenerate it from the diver's real workbook:

```bash
node fixtures/scripts/make-xlsx.mjs "~/Downloads/Dive Log.xlsx"
```

Values come from `spreadsheet-sample.csv`, which is already the redacted
version of these same rows, so no new personal data can enter the repository
through that script. Every part of the file except the worksheet and the
shared strings is Excel's own bytes, kept as they were.

`xlsx.test.ts` asserts the workbook and the CSV produce **identical**
observations. That equivalence is the strongest statement in the suite: a
shifted column, a formula read as text or a lost decimal all break it.

## The golden snapshot

`expected/merged.json` is both files merged: 24 dives from 24 spreadsheet rows
and 6 computer dives, six of them carrying both sources. It was read line by
line once and is asserted against on every change to the import engine after
that.

```bash
pnpm --filter "@mydivelog/*" build && node fixtures/scripts/snapshot.mjs
```

The build is required: the script is a thin CLI over
`packages/importers/src/snapshot.ts` and loads it from that package's `dist`.
The golden test imports the same function from source instead, so the
package's tests never depend on its own build output.

**Regenerating is not a way to make a failing test pass.** A diff here means
the engine now merges someone's dive history differently. Read it, understand
why, and only then commit it.

Note what the snapshot does *not* prove. Every UDDF dive in the fixture also
exists in the spreadsheet, so removing the `leadquantity` sentinel leaves the
merged result unchanged — weight is a `configured` field where the diver's
record already outranks the watch, and precedence covers it. The case that
depends on the sentinel is a dive the computer alone knows about, and
`golden.test.ts` asserts that separately by importing the UDDF into an empty
logbook. A perturbation test that only exercises the merged path would have
reported the sentinel as covered when it was not.

## Regenerating the fixtures

The full originals are gitignored. To regenerate from them:

```bash
node fixtures/scripts/redact.mjs <path-to-xlsx-json> <path-to-uddf>
```

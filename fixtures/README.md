# Fixtures

Test data for the import and merge engine.

## What's here

| File                     | Source                                          | Purpose                                        |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------- |
| `spreadsheet-sample.csv` | Redacted from a real 197-row dive log           | Generic tabular importer, column mapping       |
| `uddf-sample.uddf`       | Redacted from a real Oceanic+ UDDF 3.2.1 export | UDDF importer, profile decoding                |
| `expected/merged.json`   | Hand-verified, then generated                   | Golden snapshot of the merged result           |

## Redaction

The originals are one diver's real history. Dive sites plus timestamps reveal
home location and travel patterns — see `docs/10-security-privacy.md` — so the
committed fixtures are reduced and shifted:

- Only the overlapping window is kept, plus a few non-overlapping dives on each
  side, so merge behavior is still exercised
- Waypoint series are downsampled and truncated
- Coordinates are offset by a fixed random vector, preserving relative geometry
  (so site clustering still works) while not identifying real locations

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

Do not "clean up" these files. A fixture that parses easily tests nothing.

## The golden snapshot

`expected/merged.json` is both files merged: 24 dives from 24 spreadsheet rows
and 6 computer dives, six of them carrying both sources. It was read line by
line once and is asserted against on every change to the import engine after
that.

```bash
node fixtures/scripts/snapshot.mjs
```

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

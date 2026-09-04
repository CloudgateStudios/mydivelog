# @mydivelog/importers

Format knowledge. One function per format, each producing `DiveObservation[]`.

Parsers are **pure**: they take bytes or text and return observations. No
network, no filesystem, no database. Stage 3 of the pipeline in
[docs/05-import-merge-engine.md](../../docs/05-import-merge-engine.md).

This is a separate package from `@mydivelog/domain` because format knowledge
carries dependencies — an XML parser, eventually a workbook reader — and the
domain package is deliberately dependency-free so it stays trivially testable.

## Rules

1. **Errors are per-row, never fatal for the batch.** A file of 197 dives with
   one unparseable date imports 196 and reports the one.
2. **`raw` is never dropped.** A parser that missed a field can be improved
   later without asking the diver to upload the file again.
3. **Absent is `undefined`.** Never `0`, never `''`. See the `leadquantity`
   trap in the source data analysis.
4. **Every importer ships with a real fixture file.** No synthetic-only tests.

# ADR 011 — Sync engine: PowerSync over a custom build

**Status:** Accepted, provisional — confirmed or reversed by a prototype gate at the start of Phase 8
**Date:** 2026-08-26
**Phase:** 0 spike

## Context

Phase 8 builds offline-first sync for the Flutter apps: a local SQLite database
as the device's source of truth, background reconciliation, and conflict
resolution. The roadmap budgets four weeks.

The [offline sync plan](../07-offline-sync.md) originally leaned toward building
this, on the stated grounds that managed engines impose row-level
last-write-wins, which is wrong for data carrying field-level provenance.

**That premise was incorrect, and checking it is what this spike was for.**

## What the evaluation found

### PowerSync

PowerSync syncs Postgres to on-device SQLite. The critical detail is the shape
of its **write** path: client mutations do not go to Postgres. They queue
locally, and an `uploadData` function hands them to **an endpoint we own**, as
`CrudEntry` operations (PUT / PATCH / DELETE). Our backend then writes to
Postgres however it likes.

This means the objection that motivated building our own does not hold.
Conflict resolution is explicitly ours to implement — the documentation names
field-level last-write-wins, custom metadata for resolution context, recording
both versions for user resolution, and business-rule validation as supported
patterns. Our source-class precedence and provenance logic in `packages/domain`
applies verbatim, on our own servers, exactly as it would have with a custom
engine.

What PowerSync supplies is the half we would otherwise build and then maintain:
partial replication, the sync protocol, checkpointing, reconnection, durable
upload queues, and a mature Flutter/Dart SDK.

Notable constraints:

- The backend may receive **duplicate** operations, so upload handling must be
  idempotent. We already require `Idempotency-Key` on unsafe methods, so this
  costs nothing.
- There is no automatic merging at the PowerSync layer. Detection and
  resolution are entirely ours. This is a feature for us, not a gap.
- It is a commercial product with an open-source, self-hostable core.

### ElectricSQL

Electric is **read-path only**. It streams Postgres changes to clients via
logical replication and its Shape primitive, and explicitly does not provide a
write path back into Postgres.

For MyDiveLog that removes most of the benefit: writes, conflicts, and the
upload queue — the genuinely hard and risky part — would still be ours to
build, and we would carry an additional Elixir service alongside Postgres for
the easier half. Its Dart client story is also less developed than PowerSync's.

Rejected.

### Custom

Full control and no vendor in a core product function, at a cost of ~4 weeks
plus indefinite maintenance of protocol edge cases: reconnection storms,
partial-batch failures, checkpoint corruption, clock skew. This is a category
of bug that is expensive to find and embarrassing to ship, and it is not where
this product's advantage lies. Our advantage is the merge engine, and PowerSync
does not touch it.

## Decision

**Adopt PowerSync for Flutter offline sync.** Implement conflict resolution in
our own `uploadData` endpoint, reusing `packages/domain` merge logic.

Provisional, with a gate: during Phase 7, before Phase 8 begins, build a
throwaway prototype that syncs `dives` for one user and resolves a deliberate
field-level conflict — two devices editing different fields of one dive, then
both editing `notes`. If that cannot be expressed cleanly, revert to a custom
engine with three weeks still unspent.

## Consequences

**Good**

- Phase 8 shrinks substantially; the saved time goes to the import engine.
- Merge semantics stay ours and stay in one place, shared with the importer.
- A maintained Flutter SDK instead of a hand-rolled Dart sync client.
- The idempotency requirement is already satisfied by the API design.

**Costs and risks**

- A vendor dependency on a core function. Mitigated: the core is open source
  and self-hostable, and our conflict logic — the part with real value — lives
  on our side regardless.
- Per-user cost at scale; revisit in the [cost model](../12-cost-model.md)
  before launch.
- Local SQLite schema becomes partly PowerSync's concern, constraining some
  Drift choices.

**Schema implications**

- The `ChangeLog` table in the [data model](../04-data-model.md#sync--audit) was
  designed to drive our own delta pull. PowerSync's read path uses logical
  replication instead. Keep `ChangeLog` — the web client and any future
  non-Flutter client still need a delta endpoint — but it is no longer on the
  Flutter critical path, and Phase 1 should not over-invest in it.
- `AuditEvent` is unaffected; it was always a separate concern.

## Correction

Earlier planning stated that off-the-shelf engines force row-level
last-write-wins. That is not true of PowerSync, whose writes route through a
developer-controlled backend. [docs/07-offline-sync.md](../07-offline-sync.md)
has been corrected.

## Sources

- https://docs.powersync.com/handling-writes/custom-conflict-resolution
- https://electric-sql.com/docs/guides/writes
- https://github.com/electric-sql/electric

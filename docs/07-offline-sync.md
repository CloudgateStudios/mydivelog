# Offline Sync

Dives happen on boats, on liveaboards, and on shorelines in Bonaire. The moment a diver
wants to log is exactly the moment they have no signal. Offline is the normal case, not the
degraded one.

## Model

**The local SQLite database is the source of truth for the device.** The UI reads and writes
only local data and never awaits the network. Sync is a background reconciliation process
whose failure is invisible to the user.

```
┌──────────── Flutter app ─────────────┐
│                                      │
│   UI  ──read/write──►  Drift SQLite  │   ← always, no network in the path
│                            │         │
│                       outbox queue   │
│                            │         │
│                       sync engine    │
└────────────────────────────┼─────────┘
                             │ when connectivity allows
                   ┌─────────▼─────────┐
                   │  /v1/sync/push    │
                   │  /v1/sync/changes │
                   └───────────────────┘
```

## What Makes It Tractable

Three decisions from the data model do most of the work:

1. **Client-generated UUIDv7 ids.** No id negotiation, no temporary-id remapping. A dive
   created on a boat has its final identity from the first keystroke.
2. **Tombstones everywhere.** Deletes are `deletedAt`, so a client that was offline for a
   month learns what was removed.
3. **A monotonic `ChangeLog` per user.** The client holds one integer cursor. Delta sync is
   "give me everything after `seq`."

## Pull

```
GET /v1/sync/changes?since=1042&limit=500
```
```json
{
  "changes": [
    { "seq": 1043, "entityType": "dive", "entityId": "0192f…",
      "operation": "upsert", "version": 3, "entity": { … } },
    { "seq": 1044, "entityType": "site", "entityId": "0192a…",
      "operation": "delete", "version": 2 }
  ],
  "nextSeq": 1044,
  "hasMore": false
}
```

Applied in a single local transaction; the cursor advances only on success. Changes
originating from this `deviceId` are filtered server-side so a device never echoes its own
writes back to itself.

New device → `GET /v1/sync/bootstrap` returns a snapshot plus the starting `seq`, paginated.
Profiles are **not** included; they download lazily on first view and are cached with an LRU
budget, because a 500-dive history of profiles is not something to push onto a phone at
signup.

## Push

The outbox holds intents, not diffs — `{ entityType, entityId, operation, payload,
baseVersion, clientUpdatedAt, idempotencyKey }` — batched on reconnect.

```json
POST /v1/sync/push
{ "deviceId": "…", "changes": [ … ] }
```
```json
{
  "results":   [{ "entityId": "0192f…", "status": "applied", "version": 4 }],
  "conflicts": [{ "entityId": "0192b…", "serverVersion": 7, "serverEntity": { … },
                  "conflictingFields": ["notes"] }]
}
```

Ordering rules: parents before children (site before the dive referencing it), creates
before updates before deletes, and a batch is applied in dependency order server-side rather
than trusting client ordering.

## Conflict Resolution

`baseVersion` gives optimistic concurrency. If the server's version differs, the row is
resolved rather than rejected:

| Case | Resolution |
|---|---|
| Server unchanged since `baseVersion` | Apply |
| Disjoint fields changed | **Field-level merge.** Apply the client's fields, keep the server's others. |
| Same field, different values, client is newer | Apply client, record prior value |
| Same field, different values, server is newer | Keep server, return the conflict to the client |
| **`notes` differs on both sides** | **Never auto-resolve.** Both retained, surfaced to the diver. |
| Deleted on server, edited on client | Resurrect as a draft, ask the diver |
| Deleted on client, edited on server | Apply delete, but keep it restorable for 30 days |

Field-level rather than record-level merge is what makes this bearable in practice: a diver
adding a rating on their phone while their laptop adds a buddy should never produce a
conflict dialog. Only genuine same-field disagreement reaches the user, and only for fields
where losing text would matter.

Server timestamps arbitrate, never client clocks — phone clocks drift and change timezone
mid-trip. `clientUpdatedAt` is advisory ordering information, not authority.

**Provenance and sync interact:** a sync write is a `manual` source. It follows the same
precedence rules as an import, which means an offline edit correctly out-ranks a
spreadsheet import for subjective fields and correctly loses to instrument data for measured
ones. The two systems share one merge implementation in `packages/domain`.

## Media & Profiles

Large binaries do not travel through the sync protocol.

- Recorded locally with a placeholder row that syncs immediately
- Uploaded separately on unmetered connectivity (user-configurable), resumable, retried with
  backoff
- The dive is complete and useful before its photos arrive

## Failure Handling

| Failure | Behavior |
|---|---|
| No connectivity | Silent. Queue grows. No error UI. |
| Server 5xx | Exponential backoff with jitter, cap 15 min |
| 401 | Refresh token; if that fails, keep queueing and prompt for sign-in without data loss |
| 409 conflict | Route to resolution, never drop |
| 422 permanently invalid | Quarantine the item, surface it once, keep the rest syncing |
| Local DB corruption | Rebuild from `bootstrap`; the outbox is journaled separately |

A poisoned item must never block the queue. One bad record from a client-side bug cannot
stop a diver's other 40 dives from syncing.

## Testing

- Deterministic simulation: two virtual devices plus a server, scripted partitions,
  reordering, and duplicate delivery. Assert convergence.
- Property test: apply any permutation of a change set in any order → identical final state.
- Long-partition test: 30 days offline, 60 local dives, then reconnect.
- Clock-skew test: device 4 hours off, timezone changed mid-trip.
- Kill-during-sync test: process terminated mid-push; assert no duplicates and no loss on
  restart.

## Buy vs Build

Managed sync engines exist — **PowerSync** and **ElectricSQL** both target exactly this
Postgres-to-SQLite problem and both would save weeks.

The reason to build here is that MyDiveLog's merge semantics are unusually specific:
field-level provenance, source-class precedence, and never-overwrite notes. Off-the-shelf
engines give last-write-wins on rows, which is wrong for this data and would have to be
worked around at every layer.

**Decision:** build, but evaluate PowerSync concretely in a two-day Phase 0 spike before
committing. If it can express field-level custom conflict resolution, use it. The
[ADR](./decisions/) records the outcome. Keeping the sync protocol behind a clean interface
in the Flutter app preserves the option either way.

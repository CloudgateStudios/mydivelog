# Offline Sync Plan

## Why Offline First Matters

Divers often log dives on boats, islands, liveaboards, remote beaches, or international trips where signal is unreliable or expensive. The Flutter app must allow users to create, edit, search, and review their log without the network.

## Local Data Store

The final mobile persistence choice is deferred until the mobile phase. The current preferred direction is SQLite on device through a Flutter persistence layer with schema migrations such as Drift.

Local tables should mirror syncable server collections:

- Dives.
- Dive conditions.
- Locations.
- Dive sites.
- Gear.
- Gear usage.
- Dive type tags.
- Gas mixes.
- Media metadata.
- Pending mutations.
- Sync state.

## IDs

Clients should create stable IDs locally before sync. Use UUIDv7, ULID, or another sortable opaque ID. This lets offline-created dives reference offline-created locations, sites, and gear before the server sees them.

## Mutation Log

Every offline write should create or update a pending mutation record.

Mutation fields:

- `clientMutationId`
- `deviceId`
- `collection`
- `entityId`
- `operation`
- `payload`
- `baseServerRevision`
- `createdAt`
- `attemptCount`
- `lastError`

The UI should read from local tables immediately, not wait for sync.

## Pull Strategy

The app should store a server sync cursor per user and device. Pull returns changes since that cursor, including soft deletes.

Pull behavior:

- Run after login.
- Run on app foreground when network is available.
- Run after a successful push.
- Support incremental pages for large logs.
- Never assume local data is complete until initial sync finishes.

## Push Strategy

Push pending mutations in dependency order:

1. Locations.
2. Dive sites.
3. Gear and tags.
4. Dives.
5. Gas, conditions, gear usage, and media links.

The server must safely ignore duplicate `clientMutationId` values.

## Conflict Handling

Use server revisions for conflict detection. For MVP, use field-level merge for low-risk fields and user-visible conflict resolution for high-risk conflicts.

Recommended rules:

- If the entity was changed only locally, accept local change.
- If the entity was changed only remotely, apply remote change.
- If different fields changed, merge automatically.
- If the same field changed on both sides, mark conflict.
- Deletes should not permanently remove data until resolved if there are local edits.

Conflict examples:

- User edits dive notes on mobile while also editing notes on web.
- User deletes a gear item on web while a pending offline dive references it.
- User renames a location on one device and merges spreadsheet import on another.

### Concrete Conflict Use Cases

#### Different Fields Changed

Scenario:

- Web changes dive 42's notes from `Great reef` to `Great reef, saw turtles`.
- Mobile, while offline, changes dive 42's water temperature from `80 F` to `79 F`.

Result:

- Auto-merge.
- Keep the web note change.
- Keep the mobile water temperature change.
- Return the merged server record to the mobile app.

Why:

- Different fields changed, so no user intent is lost.

#### Same Field Changed

Scenario:

- Web changes dive 42's max depth from `70 ft` to `72 ft`.
- Mobile, while offline, changes the same dive's max depth from `70 ft` to `68 ft`.

Result:

- Mark as conflict.
- Preserve both values.
- Ask the user which value is correct or let them enter a new value.

Why:

- Last-write-wins could silently corrupt the dive log.

#### Delete Versus Edit

Scenario:

- Web deletes dive 42.
- Mobile, while offline, edits dive 42's notes and duration.

Result:

- Mark as conflict.
- Do not permanently delete until resolved.
- Offer choices: keep deleted, restore with mobile edits, or restore and manually edit.

Why:

- A deletion and an edit are both strong user intent.

#### Dive Number Conflict

Scenario:

- Web creates a new dive numbered `200`.
- Mobile, while offline, also creates a new dive numbered `200`.

Result:

- Mark as conflict.
- Do not allow duplicate `userDiveNumber`.
- Offer renumbering options: move mobile dive to next available number, renumber a range, or manually choose a number.

Why:

- Dive numbers must remain unique and sequential per user.

#### Referenced Gear Deleted

Scenario:

- Web retires or deletes a gear item.
- Mobile, while offline, logs a dive using that gear item.

Result:

- If retired, allow the reference and show retired status.
- If deleted, mark as conflict or restore as archived gear depending on deletion policy.

Why:

- Historical dives should not lose gear context accidentally.

#### Location Rename During Import

Scenario:

- Web renames `Bonaire` to `Bonaire, Dutch Caribbean`.
- Another device imports spreadsheet rows referencing `Bonaire`.

Result:

- Match by location ID if possible.
- If only names are available, suggest a match in review rather than creating a duplicate automatically.

Why:

- Imports should avoid duplicate location/site records but should not guess destructively.

## Syncable Record Metadata

Each syncable record should include:

- `id`
- `ownerUserId`
- `createdAt`
- `updatedAt`
- `deletedAt`
- `serverRevision`
- `lastModifiedByDeviceId`

## Media Offline Behavior

For MVP:

- Allow attaching local photos while offline.
- Store local file references and upload when online.
- Show upload state per asset.
- Keep dive record sync independent of media upload success.

Later:

- Background upload.
- Compression and thumbnail generation.
- Resume multipart uploads.

## User Experience Requirements

The Flutter app should clearly show:

- Current offline or online state.
- Unsynced changes count.
- Per-dive sync errors when action is needed.
- Last successful sync time.
- Conflict resolution screens when automatic merge is unsafe.

Avoid blocking the diver from logging a new dive because older sync work failed.

## Testing Matrix

Test these scenarios before launch:

- Create dive offline, sync later.
- Create location and dive site offline, then sync dive referencing both.
- Edit the same dive on web and mobile.
- Delete a dive on web while mobile has pending edits.
- Reinstall app and restore from server.
- Airplane mode during push.
- App killed during push.
- Duplicate push retry.
- Large account with hundreds or thousands of dives.

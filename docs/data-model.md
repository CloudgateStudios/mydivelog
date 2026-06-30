# Data Model

## Modeling Principles

- Use opaque stable IDs as primary keys.
- Keep user-facing dive numbers separate from primary keys.
- Store measured values with both the entered unit and a normalized canonical value where unit conversion matters.
- Model multi-value fields as related rows or tags rather than comma-separated text.
- Store derived values only when there is a performance or audit reason.
- Use soft deletion for syncable user data.
- Preserve imported raw values for traceability.

## Core Entities

### users

Represents an account holder.

Key fields:

- `id`
- `email`
- `displayName`
- `primaryAuthProvider`
- `homeUnitSystem`: `imperial` or `metric`, used as the default display and input preference
- `createdAt`
- `updatedAt`

### user_identities

Links a MyDiveLog user to external sign-in providers. The initial product should support Google and Apple without storing MyDiveLog-managed passwords.

Key fields:

- `id`
- `userId`
- `provider`: `google` or `apple`
- `providerSubject`
- `emailAtProvider`
- `emailVerified`
- `displayNameAtProvider`
- `linkedAt`
- `lastLoginAt`

Constraints:

- Unique `provider` plus `providerSubject`.
- A user may link multiple providers to the same MyDiveLog account.
- Account creation should merge only when the provider gives a verified email and the merge policy is explicit.

### sessions

Server-owned session records for browser, admin, and future mobile clients. Store only hashed opaque tokens, never raw session or refresh tokens.

Key fields:

- `id`
- `userId`
- `sessionTokenHash`
- `refreshTokenHash`
- `kind`: user, admin, mobile
- `createdAt`
- `expiresAt`
- `refreshExpiresAt`
- `rotatedAt`
- `revokedAt`
- `lastSeenAt`
- `ipHash`
- `userAgentHash`

Rules:

- Web and admin clients should use secure HttpOnly SameSite cookies.
- Admin sessions should use a separate session kind and shorter refresh lifetime.
- Mobile clients should use short-lived access tokens plus rotating refresh tokens when mobile is implemented.
- Re-authentication is required for sensitive actions such as account deletion, identity linking, and export requests.
- Revoked sessions must be rejected immediately.

## Unit Strategy

Home units should be a preference, not a restriction. A user who normally uses imperial units may still enter a dive in meters, bar, kilograms, or Celsius when traveling, renting equipment, following a divemaster briefing, or importing a metric dive computer file.

For every measurement that can vary by region or equipment, store:

- `enteredValue`: the exact numeric value the user typed or imported.
- `enteredUnit`: the unit used at entry time.
- `canonicalValue`: the converted value in the system's canonical unit.
- `canonicalUnit`: the canonical unit for that measurement.

Recommended canonical units:

| Measurement | Input examples | Canonical unit |
| --- | --- | --- |
| Depth | feet, meters | meters |
| Visibility | feet, meters | meters |
| Temperature | Fahrenheit, Celsius | Celsius |
| Weight carried | pounds, kilograms | kilograms |
| Tank pressure | psi, bar | bar |
| Tank volume | cubic feet, liters | liters |

This preserves user intent while making search, sorting, summaries, and analytics reliable. For example, a user could enter `18 m` on a trip, see it displayed as `18 m` on the dive detail if desired, and still have the log list show `59 ft` when their display preference is imperial.

Implementation notes:

- Do not force users to switch their account-wide home unit system to enter one metric dive.
- Forms should default to the user's home unit system, then remember recent per-field unit choices during a trip.
- Imports should preserve source units whenever they are known.
- API consumers should not have to guess whether a numeric value is imperial or metric.
- Rounding should happen at display time, not in stored canonical values.

### diver_profiles

Stores diver-specific profile data separate from auth identity.

Key fields:

- `id`
- `userId`
- `certificationLevel`
- `certificationAgency`
- `startedDivingOn`
- `bio`
- `avatarMediaId`

### dives

The main log entry.

Key fields:

- `id`
- `userId`
- `userDiveNumber`
- `diveDate`
- `timeInLocal`
- `timeOutLocal`
- `durationSeconds`
- `timezone`
- `locationId`
- `diveSiteId`
- `waterType`
- `entryType`
- `maxDepthEnteredValue`
- `maxDepthEnteredUnit`
- `maxDepthMeters`
- `weightCarriedEnteredValue`
- `weightCarriedEnteredUnit`
- `weightCarriedKilograms`
- `notes`
- `visibility`: private, unlisted, shared, public
- `publicSlug`
- `publishedAt`
- `createdAt`
- `updatedAt`
- `deletedAt`
- `clientRevision`
- `serverRevision`

Rules:

- `userDiveNumber` must be unique per user.
- Dive numbers should remain sequential for the user's log, but they are user-settable.
- If a user attempts to create or edit a dive with an existing number, the app should offer a renumbering flow rather than allowing duplicates.
- Renumbering should be transactional so the log never lands in a partially-renumbered state.
- Public dives should expose only approved public fields.

Approved public dive fields for the first public release:

- Dive date.
- Location and dive site.
- Max depth.
- Duration.
- Water temperature.
- Visibility.
- Gas.
- Dive type tags.
- Public notes.

Do not expose gear, weight carried, private notes, exact timestamps, profile contact details, internal IDs, import metadata, admin metadata, or sync metadata on anonymous public dive pages.

### dive_conditions

Optional environmental details.

Key fields:

- `id`
- `diveId`
- `airTemperatureEnteredValue`
- `airTemperatureEnteredUnit`
- `airTemperatureCelsius`
- `waterTemperatureEnteredValue`
- `waterTemperatureEnteredUnit`
- `waterTemperatureCelsius`
- `visibilityEnteredValue`
- `visibilityEnteredUnit`
- `visibilityMeters`
- `current`
- `surfaceConditions`
- `weather`

### locations

A diver's known location, such as Bonaire, Cozumel, or Monterey Bay. User-owned records are the primary v1 workflow, but they should be linkable to canonical records from day one.

Key fields:

- `id`
- `userId`
- `name`
- `country`
- `region`
- `latitude`
- `longitude`
- `canonicalLocationId`

### dive_sites

A named site within or near a location. User-owned records are the primary v1 workflow, but they should be linkable to canonical records from day one.

Key fields:

- `id`
- `userId`
- `locationId`
- `name`
- `latitude`
- `longitude`
- `siteType`
- `canonicalDiveSiteId`

### canonical_locations

System-level location records used to create a future global location/site layer without forcing users into a public directory workflow at launch.

Key fields:

- `id`
- `name`
- `country`
- `region`
- `latitude`
- `longitude`
- `status`: draft, active, merged, archived
- `createdAt`
- `updatedAt`

### canonical_dive_sites

System-level dive site records. V1 should include the table and linking fields, but not a public site directory or full moderation workflow.

Key fields:

- `id`
- `canonicalLocationId`
- `name`
- `aliases`
- `latitude`
- `longitude`
- `siteType`
- `status`: draft, active, merged, archived
- `createdAt`
- `updatedAt`

### canonical_site_review_items

Internal review queue for likely duplicate or matchable user-owned locations/sites. This can start as a simple admin-facing diagnostic and mature later.

Key fields:

- `id`
- `userLocationId`
- `userDiveSiteId`
- `suggestedCanonicalLocationId`
- `suggestedCanonicalDiveSiteId`
- `matchReason`
- `confidence`
- `status`: pending, accepted, rejected, skipped
- `reviewedByUserId`
- `reviewedAt`

V1 rules:

- Imports create user-owned locations and dive sites first.
- The system may create review items for likely canonical matches.
- Staff can review/link records later, but public canonical site pages are deferred.
- Public dive pages can display user-owned location/site names even when no canonical link exists.
- Never auto-merge user-owned sites destructively.

### dive_type_tags

Allows multi-value dive types such as shore, boat, night, wreck, wall, drift, sunset, training, photography, or cave.

Key fields:

- `id`
- `userId`
- `name`
- `slug`

### dive_dive_type_tags

Join table between dives and dive type tags.

Key fields:

- `diveId`
- `tagId`

### gas_mixes

Represents breathing gas used on a dive.

Key fields:

- `id`
- `diveId`
- `label`
- `gasType`: air, nitrox, trimix, oxygen, other
- `oxygenPercent`
- `heliumPercent`
- `startPressureEnteredValue`
- `startPressureEnteredUnit`
- `startPressureBar`
- `endPressureEnteredValue`
- `endPressureEnteredUnit`
- `endPressureBar`
- `tankSizeEnteredValue`
- `tankSizeEnteredUnit`
- `tankSizeLiters`

For MVP, one gas mix per dive is enough, but the schema should not block multi-gas dives later.

### gear_items

User-owned gear catalog. Imported gear should become structured gear records immediately, even if the first version only has a name and inferred category. Raw import text should still be preserved on the import row for traceability.

Key fields:

- `id`
- `userId`
- `name`
- `category`
- `brand`
- `model`
- `serialNumber`
- `purchaseDate`
- `retiredAt`
- `sourceImportRowId`

### dive_gear_usage

Join table between dives and gear items.

Key fields:

- `diveId`
- `gearItemId`
- `notes`

### media_assets

Photos, videos, documents, and generated exports.

Key fields:

- `id`
- `userId`
- `kind`
- `storageKey`
- `mimeType`
- `byteSize`
- `checksum`
- `createdAt`

### dive_media

Join table between dives and media.

Key fields:

- `diveId`
- `mediaAssetId`
- `caption`
- `sortOrder`

Media should be planned in the data model, object storage, and public/private visibility rules, but not implemented in the first public release.

### import_batches

Tracks import attempts.

Key fields:

- `id`
- `userId`
- `sourceType`
- `sourceFilename`
- `status`
- `createdAt`
- `completedAt`
- `errorSummary`

### import_rows

Stores raw and parsed import data for review and traceability.

Key fields:

- `id`
- `importBatchId`
- `sourceRowNumber`
- `rawJson`
- `parsedJson`
- `status`
- `targetDiveId`
- `errorMessage`

### share_links

Supports future sharing without making visibility decisions permanent.

Key fields:

- `id`
- `userId`
- `resourceType`
- `resourceId`
- `token`
- `visibility`
- `expiresAt`
- `createdAt`
- `revokedAt`

### audit_events

Records sensitive system and admin activity.

Key fields:

- `id`
- `actorUserId`
- `targetUserId`
- `action`
- `metadataJson`
- `createdAt`

## Derived Values

Compute these from source data:

- Total number of dives.
- Total time underwater.
- Average dive duration.
- Deepest dive.
- Longest dive.
- Average water temperature.
- Dives by year, location, site, gear, gas, and type.

These can be materialized later for performance, but the source of truth should remain the individual dives.

## Indexes To Plan Early

- `dives(userId, diveDate desc, userDiveNumber desc)`
- `dives(userId, updatedAt)`
- `dives(userId, deletedAt)`
- `locations(userId, lower(name))`
- `dive_sites(userId, locationId, lower(name))`
- `gear_items(userId, lower(name))`
- `import_rows(importBatchId, sourceRowNumber)`
- `audit_events(targetUserId, createdAt desc)`

## Open Data Decisions

- Whether to store unit-aware values as repeated explicit columns or as reusable measurement objects in JSON for less common fields.
- How much dive computer profile data to support in the first schema.
- Buddy verification is later, so no buddy identity model is needed in the first public release.

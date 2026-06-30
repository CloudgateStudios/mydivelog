# API Plan

## API Style

Use a versioned HTTP JSON API for the first implementation. It should be easy for the web app, Flutter app, admin app, and future integrations to consume. Publish an OpenAPI document early and keep it in CI.

Recommended base path:

```text
/api/v1
```

## Core Conventions

- JSON request and response bodies.
- ISO 8601 timestamps.
- Stable opaque IDs.
- Cursor pagination for list endpoints.
- Explicit entered and display units for measured values.
- Idempotency keys for sync, import, media, and destructive operations.
- Structured errors with stable error codes.

Example error shape:

```json
{
  "error": {
    "code": "DIVE_NOT_FOUND",
    "message": "Dive not found",
    "requestId": "req_123"
  }
}
```

## Measurement Values And Units

The API should accept measurements as unit-aware objects so users can enter the units they have in front of them. Home units control defaults and display preferences, but any single dive can mix valid units.

Example request fragment:

```json
{
  "maxDepth": { "value": 18, "unit": "m" },
  "visibility": { "value": 40, "unit": "ft" },
  "waterTemperature": { "value": 27, "unit": "c" },
  "weightCarried": { "value": 14, "unit": "lb" }
}
```

Example response fragment:

```json
{
  "maxDepth": {
    "entered": { "value": 18, "unit": "m" },
    "canonical": { "value": 18, "unit": "m" },
    "display": { "value": 59, "unit": "ft" }
  }
}
```

Supported MVP units:

- Depth and visibility: `ft`, `m`.
- Temperature: `f`, `c`.
- Weight: `lb`, `kg`.
- Pressure: `psi`, `bar`.
- Tank volume: `cuft`, `l`.

The server should validate unit compatibility by field, convert to canonical storage values, and return display values using the caller's requested display unit system. Clients may also convert locally for instant UI feedback, but the server remains authoritative for stored canonical values.

## Authentication

Use external OAuth/OpenID Connect providers instead of MyDiveLog-managed passwords for the initial product. Start with Google and Apple. Implement the provider flows directly in the API rather than depending on a managed auth service unless that becomes necessary later. The API should create or link a local MyDiveLog user after validating the provider identity token or completing the authorization code flow.

Initial endpoints:

- `GET /auth/providers`
- `POST /auth/oauth/google`
- `POST /auth/oauth/apple`
- `POST /auth/logout`
- `POST /auth/refresh`
- `GET /me`
- `PATCH /me`
- `GET /me/identities`
- `POST /me/identities/link`
- `DELETE /me/identities/{identityId}`

Authentication rules:

- Do not store user passwords in the MyDiveLog database.
- Require verified provider identity before creating a user session.
- Support linking Google and Apple to the same MyDiveLog account.
- Prevent unlinking the last usable sign-in method.
- Treat provider subject IDs as the stable identity key, not email address alone.
- Apple private relay email addresses should not cause automatic account merging. If a user signs in with Apple using a relay address, treat it as a distinct identity unless the user is already signed in and explicitly links Apple to their existing account.
- The rest of the API should only depend on a verified `userId` and role set.
- Browser web/admin clients use secure HttpOnly SameSite cookies so access tokens are not exposed to frontend JavaScript.
- Future mobile and direct API clients use short-lived access tokens plus refresh tokens stored in platform secure storage.
- Store only hashed opaque session or refresh tokens server-side.
- Rotate refresh/session tokens.
- Use a separate session kind or cookie name for admin sessions.
- Require re-authentication for sensitive actions such as account deletion, identity linking, and export requests.
- Use CSRF tokens plus Origin/Referer checks for state-changing browser requests.

Admin authentication should run through the separate admin app and require staff roles. It may use the same direct Google/Apple provider implementation initially, but customer access and staff authorization must remain separate.

## Dive Resources

Suggested endpoints:

- `GET /dives`
- `POST /dives`
- `GET /dives/{diveId}`
- `PATCH /dives/{diveId}`
- `DELETE /dives/{diveId}`
- `GET /dives/summary`
- `POST /dives/renumber`
- `GET /public/dives/{publicDiveIdOrSlug}`

List filters:

- `fromDate`
- `toDate`
- `locationId`
- `diveSiteId`
- `tag`
- `gasType`
- `waterType`
- `search`
- `cursor`
- `limit`

## Supporting Resources

Locations:

- `GET /locations`
- `POST /locations`
- `PATCH /locations/{locationId}`
- `DELETE /locations/{locationId}`

Dive sites:

- `GET /dive-sites`
- `POST /dive-sites`
- `PATCH /dive-sites/{siteId}`
- `DELETE /dive-sites/{siteId}`

Gear:

- `GET /gear`
- `POST /gear`
- `PATCH /gear/{gearItemId}`
- `DELETE /gear/{gearItemId}`

Tags:

- `GET /dive-type-tags`
- `POST /dive-type-tags`
- `PATCH /dive-type-tags/{tagId}`
- `DELETE /dive-type-tags/{tagId}`

Media:

- `POST /media/upload-intent`
- `POST /media/{mediaId}/complete`
- `GET /media/{mediaId}`
- `DELETE /media/{mediaId}`

Public resources:

- `GET /public/dives/{publicDiveIdOrSlug}`

Public endpoints must never require authentication, but they must only return fields approved for public display. They should not expose private notes, hidden profile details, internal IDs that are not meant to be public, admin metadata, import metadata, or sync metadata.

The first public dive response may include:

- Dive date.
- Location and dive site.
- Max depth.
- Duration.
- Water temperature.
- Visibility.
- Gas.
- Dive type tags.
- Public notes.

It must not include gear, weight carried, private notes, exact timestamps, profile contact details, internal IDs, import metadata, admin metadata, or sync metadata.

## Import And Export

Import endpoints:

- `POST /imports`
- `GET /imports/{importBatchId}`
- `GET /imports/{importBatchId}/rows`
- `POST /imports/{importBatchId}/commit`
- `POST /imports/{importBatchId}/cancel`

Import duplicate detection should use dive number, date, and location/site as the first matching signals. Potential duplicates should go to review instead of being overwritten automatically.

Export endpoints:

- `POST /exports`
- `GET /exports/{exportId}`

Legal and account endpoints:

- `POST /account/export`
- `GET /account/exports/{exportId}`
- `POST /account/delete-request`
- `GET /legal/privacy`
- `GET /legal/terms`

Initial import formats:

- MyDiveLog spreadsheet mapping based on the attached workbook.
- Generic CSV with user mapping.

Initial export formats:

- CSV.
- JSON.
- Later: PDF log book and common dive computer exchange formats.

## Sync Endpoints

The Flutter app should not rely on normal CRUD alone for offline support. Add sync-specific endpoints:

- `POST /sync/pull`
- `POST /sync/push`
- `POST /sync/ack`

Pull request:

```json
{
  "deviceId": "dev_123",
  "sinceCursor": "sync_456",
  "collections": ["dives", "locations", "diveSites", "gear", "tags"]
}
```

Push request:

```json
{
  "deviceId": "dev_123",
  "changes": [
    {
      "collection": "dives",
      "entityId": "dive_123",
      "operation": "upsert",
      "clientMutationId": "mut_123",
      "baseServerRevision": 8,
      "payload": {}
    }
  ]
}
```

Push response:

```json
{
  "accepted": [],
  "conflicts": [],
  "serverCursor": "sync_789"
}
```

## Admin API

Admin endpoints should be separate by route and role:

- `GET /admin/users`
- `GET /admin/users/{userId}`
- `GET /admin/users/{userId}/dives`
- `GET /admin/imports`
- `GET /admin/audit-events`
- `POST /admin/users/{userId}/support-note`

Admin is read-only for user-owned dive data in the first public release. Staff may add support notes and inspect diagnostics, but should not mutate user logs. Admin reads and support actions must produce audit events.

## Versioning

- Use `/api/v1` for breaking API version boundaries.
- Add non-breaking fields freely.
- Do not remove or rename fields inside a version.
- The sync protocol should have its own `protocolVersion` field because mobile clients may lag behind.

## API Test Strategy

- Unit tests for domain validation.
- Integration tests against a real PostgreSQL test database.
- Contract tests from OpenAPI.
- Sync tests for replay, duplicate mutation IDs, soft deletes, and conflicts.
- Import tests with the attached workbook shape represented as fixtures.

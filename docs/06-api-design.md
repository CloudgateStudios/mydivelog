# API Design

REST over HTTPS, JSON, described by an OpenAPI 3.1 document generated from Zod schemas in
`packages/contracts`. That document generates the TypeScript client (web, admin) and the
Dart client (Flutter). No client hand-writes a model.

Base: `https://api.mydivelog.app/v1`

## Conventions

| | |
|---|---|
| Versioning | URL path (`/v1`). Additive changes in place; a new path only for breaking changes. |
| IDs | UUIDv7, **client-generatable** |
| Timestamps | ISO 8601 with explicit offset |
| Units | SI in all payloads, always. Conversion is a client concern. |
| Pagination | Cursor-based: `?limit=50&cursor=…` → `{ data, nextCursor }`. Never offset — logs grow and offsets skip records under concurrent writes. |
| Partial updates | `PATCH` with explicit-null semantics: omitted = unchanged, `null` = clear |
| Errors | RFC 9457 Problem Details |
| Idempotency | `Idempotency-Key` header on all unsafe methods |
| Rate limits | Per-user token bucket; `429` with `Retry-After` |

### Errors

```json
{
  "type": "https://mydivelog.app/errors/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "maxDepthM must be between 0 and 350",
  "instance": "/v1/dives/0192f…",
  "errors": [{ "field": "maxDepthM", "code": "out_of_range" }]
}
```

Machine-readable `type` and `errors[].code` matter because the Flutter app must render
useful messages offline without parsing English.

### Idempotency

Required, not optional, because an offline client retries blindly on reconnect. Key +
user + endpoint is stored for 24h with the response; a replay returns the original response
rather than acting again.

## Auth

OIDC with Google and Apple, plus email magic link. **No passwords are ever stored.**

```
POST /v1/auth/oauth/:provider/start      → { authorizationUrl, state }
POST /v1/auth/oauth/:provider/callback   → { accessToken, refreshToken, user }
POST /v1/auth/email/request              → 204 (always, regardless of account existence)
POST /v1/auth/email/verify               → { accessToken, refreshToken, user }
POST /v1/auth/refresh                    → { accessToken, refreshToken }   (rotating)
POST /v1/auth/logout                     → 204
GET  /v1/auth/session                    → { user, entitlements }
```

- Access token: JWT, 15 min, `Authorization: Bearer`
- Refresh token: opaque, 60 days, **rotating with reuse detection** — a reused token
  revokes the whole family and forces re-auth
- Web stores the refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie; Flutter uses
  Keychain / Keystore. Access tokens are memory-only in both.

`GET /v1/auth/session` returns entitlements alongside the user so clients never infer
capability from plan name.

## Resources

### Dives

```
GET    /v1/dives                  filters: from, to, siteId, tripId, tag, minDepthM,
                                           maxDepthM, hasProfile, q, sort
POST   /v1/dives
GET    /v1/dives/:id
PATCH  /v1/dives/:id
DELETE /v1/dives/:id              soft delete → tombstone
POST   /v1/dives/:id/restore

GET    /v1/dives/:id/profile      → summary + signed URL for the sample blob
PUT    /v1/dives/:id/profile
GET    /v1/dives/:id/sources      → what contributed to this dive
GET    /v1/dives/:id/provenance   → per-field origins and alternatives
POST   /v1/dives/:id/fields/:path/select   → choose a different source's value

POST   /v1/dives/renumber         transactional, whole-log or range
POST   /v1/dives/bulk             batched create/update, for sync push
```

Profile samples are **never inlined in the dive payload**. `GET /v1/dives/:id/profile`
returns metadata plus a short-lived signed object-storage URL; the client fetches the blob
directly. A dive list must never be able to become a 4 MB response.

`POST /v1/dives/:id/fields/:path/select` is the UI hook for "actually, use the spreadsheet's
depth." It exists because provenance exists.

### Sites, Trips, Gear, Tags, Buddies, Gas

```
GET/POST/PATCH/DELETE  /v1/sites        + GET /v1/sites/search?lat=&lon=&radiusM=&q=
                       /v1/trips        + POST /v1/trips/:id/dives
                       /v1/gear         + /v1/gear-sets
                       /v1/tags
                       /v1/buddies
                       /v1/gas-mixes
```

`GET /v1/sites/search` covers both the map view and the type-ahead. It returns public sites
plus the caller's private ones, never another user's private sites.

### Import

```
POST   /v1/imports                        → { id, uploadUrl }   direct-to-storage upload
POST   /v1/imports/:id/start              → enqueue parse
GET    /v1/imports/:id                    → status + stats
GET    /v1/imports/:id/rows               → paginated review data
PATCH  /v1/imports/:id/rows/:rowId        → { decision, matchDiveId, fieldOverrides }
POST   /v1/imports/:id/commit             → enqueue commit
POST   /v1/imports/:id/revert
GET    /v1/imports                        → history

GET    /v1/mapping-profiles
POST   /v1/mapping-profiles
POST   /v1/imports/:id/preview-mapping    → apply a mapping, return first N rows parsed
```

Uploads go **directly to object storage** via a presigned URL. A 4.6 MB UDDF is small; a
Shearwater database with 2,000 dives is not, and API instances should never be file relays.

`preview-mapping` powers the CSV column-mapper: change a mapping, see ten parsed rows
immediately, no job required.

### Export

```
POST   /v1/exports         { format, filters }  → { id }   (async)
GET    /v1/exports/:id                          → { status, downloadUrl }
GET    /v1/exports
```

Async because a PDF logbook of 500 dives with charts is not a request-cycle operation.

### Sync

```
GET  /v1/sync/changes?since=<seq>&limit=500   → { changes[], nextSeq, hasMore }
POST /v1/sync/push                            → { results[], conflicts[] }
GET  /v1/sync/bootstrap                       → full snapshot for a new device
```

See [Offline Sync](./07-offline-sync.md).

### Stats

```
GET /v1/stats/summary        totals, deepest, longest, cumulative time
GET /v1/stats/timeline?groupBy=year|month
GET /v1/stats/sites          most-dived, with geo
GET /v1/stats/depth-histogram
```

Server-computed, cached. The workbook's `Overview & Summary` sheet is the exact feature
divers want — and its `Average Dive Length` of `0.035` (a day fraction) shows why computing
it server-side beats letting every client roll its own.

### Account & Billing

```
GET    /v1/me
PATCH  /v1/me
GET    /v1/me/preferences
PATCH  /v1/me/preferences
POST   /v1/me/export-all          GDPR data portability, full archive
DELETE /v1/me                     schedules deletion, 30-day grace, emailed confirmation

POST   /v1/billing/checkout       → Stripe Checkout URL
POST   /v1/billing/portal         → Stripe Customer Portal URL
POST   /v1/webhooks/stripe        signature-verified, idempotent
```

## Admin API

Separate router (`/v1/admin`), separate guard, separate hostname, staff-only, every call
writes an `AuditEvent`.

```
GET  /v1/admin/users                    search, filter, paginate
GET  /v1/admin/users/:id                profile, counts, subscription
POST /v1/admin/users/:id/suspend
GET  /v1/admin/imports                  cross-user, filter by status/format
GET  /v1/admin/imports/:id              full row detail — the debugging surface
GET  /v1/admin/sites/pending            private→public promotion queue
POST /v1/admin/sites/:id/promote
POST /v1/admin/sites/merge              merge duplicate public sites
GET  /v1/admin/metrics                  signups, imports, failure rates, storage
GET  /v1/admin/audit
```

Staff **cannot read dive notes or private notes** through the admin API. Import row detail
is available because that is the support workload, and it is audit-logged every time.
Impersonation, if ever added, requires explicit user consent per session.

## Ownership

Enforced at the repository layer in `packages/db`, not in controllers. Every user-owned
query takes a `userId` and filters on it. A controller that forgets is impossible because
the repository signature requires it.

Integration tests assert this: for each user-owned endpoint, user B's id returns 404 (not
403 — existence itself is not disclosed).

## Rate Limits

| Scope | Limit |
|---|---|
| Auth endpoints | 10/min per IP |
| Magic link request | 3/hour per email |
| General authenticated | 300/min per user |
| Import create | 20/hour per user |
| Sync push | 60/min per device |
| Export create | 10/hour per user |

Backed by Postgres at launch (volume is low); moved to a token-bucket store when it matters.

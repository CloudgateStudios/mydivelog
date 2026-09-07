# Roadmap

Phases are sequenced so that **the riskiest thing is proven earliest**. Phase 3 (import and
merge) comes before any polish, because if merging real-world dive data can't be made to
work well, nothing later matters.

Durations assume one focused developer. They are ranges, not commitments.

---

## Phase 0 — Foundations · ~1 week

**Deliverables**
- Monorepo: pnpm workspaces + Turborepo, layout per [Architecture](./03-architecture.md)
- Lint, format, typecheck, test, pre-commit hooks, secret scanning
- GitHub Actions: PR checks, preview environments
- `docker compose` local stack: Postgres + MinIO
- Fly.io apps and Neon projects created for dev and prod ([runbook](./runbooks/environment-setup.md))
- Empty `api`, `worker`, `web`, `admin` deployable with a health endpoint
- Fixture files committed (redacted) to `fixtures/`
- **Spike: evaluate PowerSync/ElectricSQL vs custom sync** → write [ADR](./decisions/)

**Acceptance**
- `pnpm dev` gives a working local stack from a clean clone in <10 minutes
- A PR produces a live preview URL with its own database branch
- `/health` returns 200 in dev for all four apps, each naming itself

---

## Phase 1 — Data Model · ~1.5 weeks

**Deliverables**
- Full Prisma schema per [Data Model](./04-data-model.md)
- Initial migration; seeds for tags, gas mixes, agencies, regions
- Repository layer in `packages/db` with mandatory `userId` scoping
- `packages/domain`: unit conversion, dive numbering, derived stats — pure, fully tested
- Profile blob format `mdl-profile-v1` (columnar + zstd) with encode/decode

**Acceptance**
- Every field in both sample files has a home in the schema — verified field by field
- Unit conversion round-trips within float tolerance for all quantities
- A 208-sample profile encodes to <2 KB and decodes bit-identically
- Ownership scoping is impossible to omit (compile error, demonstrated by a test)

---

## Phase 2 — API & Auth · ~2 weeks

**Deliverables**
- NestJS app, `packages/contracts` (Zod → OpenAPI → generated clients)
- Google OIDC, Apple OIDC, email magic link; rotating refresh tokens
- CRUD for dives, sites, trips, tags, gear, gas, buddies
- Dive renumbering (transactional), stats endpoints
- Idempotency middleware, rate limiting, RFC 9457 errors
- Integration tests against real Postgres

**Acceptance**
- Sign in with all three methods on dev
- Full dive lifecycle via API
- Cross-user access returns 404 on **every** user-owned endpoint (test-enforced)
- Replaying any write with the same `Idempotency-Key` is a no-op returning the original response
- OpenAPI document generates a working TS client and a working Dart client

---

## Phase 3 — Import & Merge · ~4 weeks ◄ **the proving phase**

Longest phase, lowest visible output, highest risk. Do not compress it.

**Deliverables**
- Pipeline: ingest → detect → parse → normalize → match → review → commit → revert
- `DiveObservation` IR
- Importers: **UDDF 3.x**, **XLSX/CSV with mapping profiles**, Subsurface XML, MyDiveLog JSON
- Normalization: units, **timezone repair**, sentinel stripping, taxonomy fuzzy-match,
  derived-column detection
- Matching and scoring; site geo-clustering with aliases
- Field-level merge with source precedence; provenance written per field
- Commit (idempotent, chunked) and revert (indefinite)
- Exporters: JSON, UDDF, CSV, Subsurface
- Import/export API endpoints

**Acceptance — the gate for the whole project**
- The real `Dive Log.xlsx` (197 rows) and the real UDDF (96 dives) import into one account
  and produce **one canonical history with zero duplicate dives**
- ~92–96 dives carry both spreadsheet fields *and* depth profiles
- The malformed `-00:04` offsets are corrected to −04:00, **visibly reported**, with the
  originals preserved
- `Dift` is proposed as `drift` once, not 39 times
- Bonaire sites gain both names (spreadsheet) and coordinates (UDDF)
- Importing either file twice changes nothing
- Reverting either import restores the exact prior state
- **The merged result is verified by hand once and committed as a golden snapshot test**
- Round-trip: export → clean DB → import → deep-equal
- Adversarial fixtures fail gracefully with per-row issues, never a 500, never a partial write

---

## Phase 4 — Admin Panel · ~1.5 weeks

Built before the user-facing app, because Phase 3's failures need a debugging surface.

**Deliverables**
- Next.js admin, staff auth with 2FA, Cloudflare Access
- **Import inspector** with parse replay
- Users, site moderation, format health, metrics, audit log, feature flags

**Acceptance**
- Any import batch can be inspected down to the raw source row
- A failed parse can be replayed against current code without touching user data
- Staff cannot see dive notes anywhere in the UI
- Every staff action appears in the audit log

> The last two are mechanisms rather than habits. Notes are kept out by an allowlist
> (`DIVE_SELECT`, `AUDITABLE_DIVE_FIELDS`, and their absence from `AdminUpdateDive`),
> each with a test that fails if either field is added. The audit row is written by the
> same transaction as the change it records, so an unaudited staff mutation would have to
> be a new code path rather than a forgotten line — and `admin.itest.ts` walks the whole
> surface counting rows.
>
> Still outstanding in this phase: metrics, feature flags, and a promotion *queue* for
> sites rather than a toggle on each one.

---

## Phase 5 — Web Portal · ~4 weeks

**Deliverables**
- Marketing site: landing, supported formats, pricing, docs, legal
- Onboarding: sign up → import → first dive visible
- Log list with filters and saved views; dive detail with profile chart and map
- **Full import flow** (drop → map → review → commit → undo) per [Clients](./08-clients.md)
- Export UI, sites map, trips, stats, gear, settings

**Acceptance**
- A new user goes from signup to an imported logbook without documentation
- The 197+96 import is completable **entirely through the UI**
- The review screen groups 96 identical decisions into one summary line
- Profile charts render; units follow preferences everywhere
- WCAG 2.2 AA on primary flows
- Lighthouse: performance >90, accessibility >95 on marketing pages

> The last two are measured on every pull request rather than asserted — see
> [the runbook](./runbooks/accessibility-and-performance.md).

---

## Phase 6 — Launch Hardening · ~2 weeks

**Deliverables**
- Stripe: plans, checkout, portal, webhooks, entitlements
- Privacy policy, ToS (including the [no-dive-guidance boundary](./10-security-privacy.md#liability)), sub-processor list
- GDPR export and deletion, end to end
- Monitoring, alerting, status page
- Runbooks; **backup restore drill completed and timed**
- Load test; security self-review
- Full [launch checklist](./09-deployment.md#launch-checklist)

**Acceptance**
- Real purchase, upgrade, downgrade, and refund verified in live mode
- Downgrade never removes data; over-limit accounts stay readable and exportable
- Deleting an account removes all data within 30 days, verified
- Restore drill completed within the 4-hour RTO and documented
- Alerts verified by deliberately breaking something

### ▶ Public launch

---

## Phase 7 — Flutter Apps, Online · ~3 weeks

**Deliverables**
- Flutter shell for iOS, Android, macOS, Windows
- Generated Dart client, OIDC (with Apple Sign-In), secure token storage
- Browse log, dive detail with profile chart, create/edit dives
- On-device file import (share-sheet / drag-drop) for UDDF
- TestFlight and Play internal distribution

**Acceptance**
- Same account, same data, all four platforms
- A UDDF received on a phone can be imported without a computer
- Desktop build is a desktop UI, not a scaled phone UI

---

## Phase 8 — Offline Sync · ~4 weeks

**Deliverables**
- Drift local schema mirroring the server
- Outbox queue, `ChangeLog` pull, bootstrap
- Field-level conflict resolution sharing `packages/domain` merge logic
- Background sync, retry, poison-item quarantine
- Conflict resolution UI
- Deterministic simulation test harness

**Acceptance**
- Airplane mode: log 20 dives, reconnect, all sync, zero duplicates
- Two devices editing different fields of one dive → merged, no user prompt
- Two devices editing the same **notes** → both preserved, diver asked
- 30-day partition with 60 local dives converges
- Kill mid-sync → no loss, no duplication on restart
- A poisoned record never blocks the queue

---

## Phase 9 — Media & Social · ~4 weeks

Photos, video thumbnails, per-dive galleries; buddy linking (consensual, two-way); shareable
dive and trip links with granular privacy and optional geo-fuzzing; PDF logbook export.

**Note:** media materially changes the cost model — revisit [Cost Model](./12-cost-model.md)
before starting.

---

## Phase 10 — Integrations · ongoing

Garmin FIT, Shearwater Cloud, Suunto, Mares, Scubapro, DAN DL7 importers. Garmin Connect and
other OAuth integrations with continuous sync. Bluetooth dive-computer download (large, per
vendor). Paper-log OCR. Apple Watch / HealthKit dive sessions.

Prioritized by what real users actually ask for, measured through the format-health screen.

---

## Timeline

```
Phase 0  ▓                                       ~1w
Phase 1  ▓▓                                      ~1.5w
Phase 2  ▓▓▓                                     ~2w
Phase 3  ▓▓▓▓▓▓▓▓                                ~4w   ◄ the gate
Phase 4  ▓▓                                      ~1.5w
Phase 5  ▓▓▓▓▓▓▓▓                                ~4w
Phase 6  ▓▓▓▓                                    ~2w
─────────────────────────────────── LAUNCH ────────── ~16w / ~4 months
Phase 7  ▓▓▓▓▓▓                                   ~3w
Phase 8  ▓▓▓▓▓▓▓▓                                 ~4w
Phase 9+ ongoing
```

## Guardrails

1. **Phase 3's acceptance criteria are the go/no-go for the product.** If merging real data
   can't be made reliable, stop and reconsider before building six more phases on top.
2. **Do not start Phase 5 before Phase 4.** Debugging imports through `psql` does not scale
   past the first week of real users.
3. **Every importer ships with a real fixture file.** No exceptions, no synthetic-only tests.
4. **The golden fixture test runs on every PR** and is never skipped or updated without a
   deliberate, reviewed re-verification.
5. **No phase is done until its acceptance criteria pass in dev**, not on a laptop.

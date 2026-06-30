# Implementation Roadmap

## Phase 0: Decisions And Project Setup

Deliverables:

- Confirm NestJS API scaffold.
- Confirm separate Next.js web and admin apps.
- Confirm Prisma and migration workflow.
- Choose Flutter local persistence library.
- Choose direct OAuth/OpenID Connect implementation strategy for Google and Apple sign-in.
- Confirm separate admin app deployment shape and staff-only access policy.
- Set up monorepo repository structure.
- Set up pnpm workspaces and Turborepo.
- Set up Terraform skeleton.
- Set up formatting, linting, testing, and CI.

Acceptance criteria:

- New contributors can run tests locally.
- CI validates formatting and tests.
- Database migrations can run locally from a clean database.
- GitHub Actions can build API, web, admin, and worker targets.
- Monorepo tasks can run per workspace and across the repo.

## Phase 1: Database Foundation

Deliverables:

- Initial PostgreSQL schema.
- Migrations for users, external identities, profiles, dives, locations, sites, gear, tags, gas, imports, and audit events.
- Seed data for common dive types and gas types.
- Basic indexes.
- Unique constraint for user-owned dive numbers.

Acceptance criteria:

- Schema supports every field in the attached workbook.
- Derived summary values can be computed from source rows.
- User data ownership is enforced at the query/service layer.
- Duplicate dive numbers are prevented per user.

## Phase 2: API Foundation

Deliverables:

- Authenticated API skeleton.
- Google and Apple sign-in flow with no MyDiveLog password storage.
- CRUD endpoints for dives, locations, sites, gear, tags, and gas.
- Dive renumbering endpoint.
- Summary endpoint.
- OpenAPI document.
- Integration tests against PostgreSQL.

Acceptance criteria:

- A user can sign in with Google or Apple.
- A user can create, update, list, and delete dives through API calls.
- A user can resolve dive-number conflicts through a transactional renumbering flow.
- All user-owned endpoints enforce ownership.
- API contract can be used by web, Flutter, and admin clients.

## Phase 3: Import And Export

Deliverables:

- Import batch model.
- Spreadsheet parser for the attached workbook shape.
- Import review data.
- Commit flow that creates dives, locations, sites, tags, gas, and structured gear records.
- Duplicate detection using dive number, date, and location/site signals.
- CSV and JSON export.

Acceptance criteria:

- The sample workbook can be parsed into reviewable rows.
- Import can be committed without duplicate rows on retry.
- Potential duplicate dives are reviewed instead of overwritten automatically.
- User can export their log after import.

## Phase 4: Sync Protocol

This phase should be split. Add sync-ready metadata to the database early, but implement push, pull, ack, and conflict workflows later with the Flutter app so admin and web can ship faster.

Deliverables:

- Sync metadata on syncable tables.
- Draft sync protocol contract.
- Documented conflict strategy.

Acceptance criteria:

- Syncable records have stable IDs, timestamps, soft deletes, and revision fields.
- Future mobile implementation can add sync endpoints without redesigning core tables.
- Protocol decisions are documented before Flutter implementation begins.

## Phase 5: Admin MVP

Deliverables:

- Staff auth and roles.
- User lookup.
- User detail view.
- Import and export diagnostics.
- Dive count and recent activity.
- Sync-readiness diagnostics once sync metadata exists.
- Audit event viewer.

Acceptance criteria:

- Staff can support users without database access.
- Staff access to user-owned dive data is read-only.
- Sensitive actions are audited.
- Admin routes are inaccessible to normal users.
- Import failures and account issues can be investigated from the app.
- Admin is deployed as a separate app or staff-only subdomain from the public website.

## Phase 6: Web App MVP

Deliverables:

- Auth.
- Public homepage.
- Dive list and detail/edit.
- Summary dashboard.
- Import review.
- Export controls.
- Account settings.
- Public dive pages for dives explicitly marked public.
- Privacy policy, terms, account deletion request, and complete data export.

Acceptance criteria:

- A user can manage their log from a browser.
- Imported data is visible and editable.
- Summary stats match the underlying dive data.
- Anonymous visitors can view public dives but cannot access private dive data.
- Users can export their data and request account deletion.

## Phase 7: Flutter Offline MVP

Deliverables:

- Local SQLite schema.
- Local dive CRUD.
- Pending mutation queue.
- Initial sync, pull, and push.
- Offline status UI.
- Conflict display for unresolved conflicts.
- Push, pull, and ack sync endpoints if not already implemented.

Acceptance criteria:

- A user can log a dive with no signal.
- The dive appears immediately in the local log.
- The dive syncs later without data loss.
- App remains usable when sync fails.
- Duplicate sync mutations are harmless.
- Conflicts are returned in a structured way.

## Phase 8: Sharing And Community

Deliverables:

- Per-dive visibility.
- Share links.
- Public dive pages.
- Optional media gallery.
- Basic buddy tagging.

Acceptance criteria:

- User controls what is private or shared.
- Shared pages reveal only intended fields.
- Revoking a share link immediately removes access.

## First Engineering Milestone

The first milestone should be a local backend that can:

1. Run database migrations.
2. Create or link a user through Google or Apple identity, with a dev-only seed option for local testing if needed.
3. Create and list dives through the API.
4. Import the attached workbook into structured rows.
5. Compute the same summary categories as the workbook.

That milestone proves the core model before UI work begins.

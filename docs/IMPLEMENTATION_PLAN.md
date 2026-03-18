# mydivelog.app — Implementation Plan

**Version:** 1.1  
**Last Updated:** 2026-03-18

---

## Overview

The build is organized into four phases. Each phase delivers a usable slice of the product and can be shipped independently.

| Phase | Focus | Est. Duration |
|---|---|---|
| 1 | Foundation — monorepo scaffold, infra, auth, user accounts | 2–3 weeks |
| 2 | Core product — dive logs, trips, sites, stats | 3–4 weeks |
| 3 | Gear, certs, freemium enforcement | 2–3 weeks |
| 4 | Pro features — imports, advanced stats, admin app | 3–4 weeks |

---

## Phase 1 — Foundation

**Goal:** Monorepo running locally and in staging with all three apps scaffolded and auth working end-to-end.

### 1.1 Monorepo Scaffold

- [ ] Initialize the `mydivelog` monorepo
  ```bash
  npx create-turbo@latest mydivelog --package-manager pnpm
  ```
- [ ] Configure `pnpm-workspace.yaml` to include `apps/*` and `packages/*`
- [ ] Create `turbo.json` with task pipeline: `build`, `dev`, `lint`, `typecheck`, `test`
- [ ] Set up shared packages:
  - `packages/types` (`@repo/types`) — shared TypeScript interfaces and enums; exports raw TS source (Just-in-Time, no build step)
  - `packages/typescript-config` (`@repo/typescript-config`) — shared `tsconfig` bases for API, Next.js apps
  - `packages/eslint-config` (`@repo/eslint-config`) — shared ESLint rules
- [ ] Set up `apps/api` (Fastify + TypeScript)
  - Initialize with `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/multipart`
  - Add Prisma: `prisma init`, configure `schema.prisma` with Supabase connection strings
  - Extend `@repo/typescript-config/base.json`
  - Add `.env.example` with all required vars documented
- [ ] Set up `apps/web` (Next.js 14, App Router, TypeScript)
  - Initialize with `create-next-app`
  - Add Tailwind CSS
  - Add `@supabase/supabase-js`, `@supabase/ssr`
  - Add TanStack Query (`@tanstack/react-query`)
  - Extend `@repo/typescript-config/nextjs.json`
- [ ] Set up `apps/admin` (Next.js 14, App Router, TypeScript)
  - Same stack as `apps/web`
  - Admin middleware: redirect to login if no session or `role !== ADMIN`
  - Extend `@repo/typescript-config/nextjs.json`
- [ ] Add root-level `CLAUDE.md` with monorepo orientation for Claude Code
- [ ] Add per-app `CLAUDE.md` files in `apps/api`, `apps/web`, `apps/admin`
- [ ] Set up Husky pre-commit hooks at repo root: lint + typecheck across all packages

### 1.2 Supabase Project Setup

- [ ] Create Supabase project (staging + production)
- [ ] Enable Google OAuth provider — add Client ID + Secret
- [ ] Enable Apple OAuth provider — add Services ID, Team ID, Key ID, private key
- [ ] Configure redirect URLs in Supabase dashboard
- [ ] Install local Supabase CLI for development (`supabase start`)
- [ ] Run initial Prisma migration (`prisma migrate dev --name init`)

### 1.3 Database — Initial Schema

- [ ] Write and apply full `schema.prisma` as defined in `DATA_MODEL.md`
- [ ] Seed script: populate initial `dive_sites` from open data source (OpenStreetMap / public dataset)
- [ ] Configure Supabase RLS policies as a secondary safety layer

### 1.4 API — Auth & User Endpoints

- [ ] Implement `authenticate` middleware (JWT validation via Supabase)
- [ ] Implement first-login user provisioning (`provisionUser` service)
- [ ] `GET /v1/users/me`
- [ ] `PATCH /v1/users/me`
- [ ] Create Stripe customer on user provisioning
- [ ] Deploy API to Vercel (configure environment variables)

### 1.5 Web — Auth Flow

- [ ] Login page (`/login`) with Google + Apple sign-in buttons
- [ ] Auth callback route (`/auth/callback`)
- [ ] Middleware protecting `/dashboard` and all app routes
- [ ] Basic dashboard shell (authenticated layout, nav sidebar)
- [ ] User settings page (display name, unit preference)
- [ ] Deploy web to Vercel

### 1.6 Vercel Configuration

- [ ] Import the `mydivelog` GitHub repo into Vercel **three times**, creating three separate projects:
  - `mydivelog-api` — root directory: `apps/api`
  - `mydivelog-web` — root directory: `apps/web`
  - `mydivelog-admin` — root directory: `apps/admin`
- [ ] Configure custom domains:
  - `api.mydivelog.app` → `mydivelog-api` project
  - `mydivelog.app` → `mydivelog-web` project
  - `admin.mydivelog.app` → `mydivelog-admin` project
- [ ] Enable **Skipping Unaffected Projects** on each Vercel project (Turborepo-powered change detection — skips builds when no relevant files changed)
- [ ] Set `admin.mydivelog.app`'s `NEXT_PUBLIC_API_URL` to `https://api.mydivelog.app` in all environments (admin always targets production API)
- [ ] Set up staging environments: `staging.mydivelog.app`, `api-staging.mydivelog.app`, `admin-staging.mydivelog.app`
- [ ] Add all environment variables per project per environment in Vercel dashboard
- [ ] Link local dev to Vercel remote cache: `turbo login && turbo link`

**Phase 1 exit criteria:** Monorepo scaffolded with all three apps. User can sign in with Google or Apple on both web and admin apps. Admin login correctly blocks non-admin users. All three apps deployed to staging via independent Vercel projects from the same repo.

---

## Phase 2 — Core Product

**Goal:** Users can log dives, browse dive sites, and view their basic stats dashboard.

### 2.1 API — Dive Endpoints

- [ ] `GET /v1/dives` (paginated, with filters)
- [ ] `POST /v1/dives`
- [ ] `GET /v1/dives/:id`
- [ ] `PATCH /v1/dives/:id`
- [ ] `DELETE /v1/dives/:id`
- [ ] Auto-increment `diveNumber` per user on creation
- [ ] Depth/temperature unit conversion in response layer based on `user.unitPreference`

### 2.2 API — Dive Site Endpoints

- [ ] `GET /v1/dive-sites` (text search + country filter + proximity search)
- [ ] `GET /v1/dive-sites/:id`
- [ ] PostGIS extension or Haversine formula for proximity queries

### 2.3 API — Stats Endpoints

- [ ] `GET /v1/stats/summary` (free tier stats)

### 2.4 Web — Dive Log

- [ ] Dive list page (`/dives`) — paginated table/cards
- [ ] New dive form (`/dives/new`)
  - Dive site autocomplete (search `GET /dive-sites`)
  - All required and optional fields
  - Tag input
- [ ] Edit dive page (`/dives/:id/edit`)
- [ ] Dive detail view (`/dives/:id`)
- [ ] Delete dive with confirmation modal

### 2.5 Web — Dive Sites

- [ ] Dive site search/browse page (`/sites`)
- [ ] Site detail page (`/sites/:id`) with map pin, depth info, recent dives at this site

### 2.6 Web — Stats Dashboard

- [ ] Basic stats cards (total dives, total bottom time, deepest dive)
- [ ] World map with dive location pins (using a library like `react-simple-maps` or Mapbox GL)

**Phase 2 exit criteria:** A user can log a complete dive entry, browse dive sites, view their logbook list, and see their basic stats dashboard.

---

## Phase 3 — Gear, Certs & Freemium

**Goal:** Complete the v1 feature set and enforce free vs. pro tier limits.

### 3.1 API — Gear Endpoints

- [ ] `GET /v1/gear`
- [ ] `POST /v1/gear` (with free tier limit enforcement)
- [ ] `GET /v1/gear/:id`
- [ ] `PATCH /v1/gear/:id`
- [ ] `DELETE /v1/gear/:id`

### 3.2 API — Certification Endpoints

- [ ] `GET /v1/certifications`
- [ ] `POST /v1/certifications` (with free tier limit enforcement)
- [ ] `GET /v1/certifications/:id`
- [ ] `PATCH /v1/certifications/:id`
- [ ] `DELETE /v1/certifications/:id`
- [ ] `POST /v1/certifications/:id/document` (Pro only — Supabase Storage upload)

### 3.3 API — Stripe Subscriptions

- [ ] `POST /v1/subscriptions/checkout` — create Stripe Checkout session
- [ ] `POST /v1/subscriptions/portal` — create Stripe Customer Portal session
- [ ] `POST /v1/subscriptions/webhook` — handle Stripe lifecycle events
  - `customer.subscription.created` → set `tier: PRO, status: ACTIVE`
  - `customer.subscription.updated` → sync period dates, cancel state
  - `customer.subscription.deleted` → set `tier: FREE`
  - `invoice.payment_failed` → set `status: PAST_DUE`
- [ ] Configure Stripe products/prices (monthly + annual) in Stripe dashboard
- [ ] Register webhook endpoint in Stripe dashboard

### 3.4 Web — Gear

- [ ] Gear list page (`/gear`)
- [ ] Add/edit gear form
- [ ] Service date reminder display (highlight items with upcoming/overdue service)

### 3.5 Web — Certifications

- [ ] Certifications list page (`/certifications`)
- [ ] Add/edit cert form
- [ ] Document upload UI (Pro badge + upgrade prompt for free users)

### 3.6 Web — Upgrade Flow

- [ ] Upgrade prompt components (shown when free tier limits are hit)
- [ ] Pricing page (`/pricing`) with monthly/annual toggle
- [ ] Checkout redirect flow (call `POST /subscriptions/checkout`, redirect to Stripe)
- [ ] Success/cancel pages post-Stripe redirect
- [ ] Subscription management page (`/settings/subscription`) — links to Stripe Portal

**Phase 3 exit criteria:** Free and Pro tiers are fully enforced. Users can subscribe via Stripe, manage their plan, and access all v1 features appropriately gated.

---

## Phase 4 — Pro Features & Admin

**Goal:** Ship all Pro-tier differentiators and the admin moderation panel.

### 4.1 API — Advanced Stats (Pro)

- [ ] `GET /v1/stats/advanced` with period filtering
- [ ] Dives over time aggregation query
- [ ] Depth distribution histogram query
- [ ] Breakdowns by water type, entry type
- [ ] Average visibility trend

### 4.2 API — Dive Computer Import (Pro)

- [ ] `POST /v1/dives/import` — accept UDDF/UDCF file upload
- [ ] UDDF parser (evaluate `uddf-parser` npm package or write minimal custom parser)
- [ ] Map parsed dive data to `Dive` schema
- [ ] Return parsed preview before committing (so user can confirm)
- [ ] `POST /v1/dives/import/confirm` — commit parsed dives to DB
- [ ] Delete temp file from Supabase Storage after processing

### 4.3 API — Dive Site Submissions (Pro)

- [ ] `POST /v1/dive-sites/submissions`
- [ ] `GET /v1/dive-sites/submissions/me`

### 4.4 API — Admin Endpoints

- [ ] Admin role middleware
- [ ] `GET /admin/submissions`
- [ ] `POST /admin/submissions/:id/approve` → create `DiveSite`, notify submitter via email
- [ ] `POST /admin/submissions/:id/reject` → notify submitter via email
- [ ] `GET /admin/users`
- [ ] `GET /admin/metrics`

### 4.5 API — Email (Transactional)

- [ ] Integrate Resend (or Postmark)
- [ ] Dive site submission approved template
- [ ] Dive site submission rejected template
- [ ] Subscription confirmation template (optional — Stripe can handle this)

### 4.6 Web — Advanced Stats (Pro)

- [ ] Charts for dives over time (bar chart — Recharts)
- [ ] Depth distribution chart
- [ ] Breakdown cards (water type, entry type)
- [ ] Date range picker for filtering

### 4.7 Web — Dive Computer Import (Pro)

- [ ] Import flow page (`/dives/import`)
- [ ] File upload (drag & drop UDDF/UDCF)
- [ ] Preview parsed dives table before confirm
- [ ] Confirm/cancel buttons

### 4.8 Web — Dive Site Submission (Pro)

- [ ] Submit site form (`/sites/submit`)
- [ ] User's submission history with status indicators

### 4.9 Admin Application (`apps/admin`)

The admin app lives in the monorepo at `apps/admin` and is scaffolded in Phase 1, but its features are built here in Phase 4. It is deployed as its own Vercel project and enforces `role: ADMIN` at the middleware level. All data operations go through the API's `/v1/admin/*` endpoints — it has no direct database connection.

**Setup & Auth**
- [ ] Admin-only middleware: check Supabase session + call `GET /v1/users/me` to verify `role === ADMIN`; redirect to `/unauthorized` if not
- [ ] Login page (Google sign-in only — no Apple required for internal tooling)
- [ ] Admin layout: sidebar nav (Submissions, Users, Metrics), header with signed-in admin name

**Dive Site Moderation**
- [ ] Submissions queue page (`/submissions`) — filterable by status (Pending / Approved / Rejected)
- [ ] Submission detail view — shows all submitted fields, map preview of coordinates
- [ ] Approve action — calls `POST /v1/admin/submissions/:id/approve`, with optional notes field
- [ ] Reject action — calls `POST /v1/admin/submissions/:id/reject`, requires a rejection reason
- [ ] Status badges and timestamps for reviewed items

**User Management**
- [ ] Users list page (`/users`) — paginated table with email, display name, subscription tier, join date
- [ ] User detail page (`/users/:id`) — full profile, subscription history, dive count, gear count
- [ ] Suspend / unsuspend user action
- [ ] Delete user action with confirmation (cascades via API)
- [ ] Manual subscription override (set tier to Pro / Free without Stripe)

**Platform Metrics**
- [ ] Metrics dashboard (`/metrics`)
  - Total registered users + growth chart
  - Active Pro subscribers + MRR estimate
  - Total dives logged + rate over time
  - Dive sites in DB (validated vs pending)
  - Recent sign-ups feed

**Phase 4 exit criteria:** All v1 features complete. Pro users have access to advanced stats, dive computer import, and site submissions. Admin app is live at `admin.mydivelog.app`, accessible only to admin-role users, with full moderation, user management, and metrics capabilities.

---

## Phase 5 — Mobile App (Flutter) — Future

The mobile app is a separate project in its own repo (`mydivelog-mobile`) and is out of scope for the initial four phases. Key setup tasks when the time comes:

- [ ] Create `mydivelog-mobile` GitHub repo
- [ ] Initialize Flutter project targeting iOS and Android
- [ ] Add `fastify-swagger` to `apps/api` to auto-generate an OpenAPI spec from route definitions
- [ ] Generate typed Dart API client using `openapi-generator` (target: `dart-dio`)
- [ ] Set up a script/CI step to regenerate the Dart client whenever `API_SPEC.md` or the swagger output changes
- [ ] Implement Sign in with Google and Sign in with Apple via `supabase_flutter` package
- [ ] Set up Codemagic or GitHub Actions + Fastlane for iOS/Android build and distribution pipeline

---

## Cross-Cutting Concerns (All Phases)

### Testing Strategy
- **API:** Vitest for unit tests on services; Supertest for route integration tests
- **Web + Admin:** Vitest + React Testing Library for component tests
- Run all tests across the monorepo with `turbo test`
- Aim for test coverage on all service-layer logic and critical API routes

### Error Monitoring
- Integrate Sentry on API, web, and admin from Phase 1
- Configure Sentry source maps per app for production

### Analytics
- Add PostHog (or Plausible for privacy-first) from Phase 2
- Track: sign-up, dive logged, upgrade initiated, upgrade completed

### CI/CD
- GitHub Actions pipeline at monorepo root: `turbo lint && turbo typecheck && turbo test`
- Vercel handles deployment automatically per app via change detection
- Manual promotion from staging → production for the admin app

# mydivelog.app — Architecture

**Version:** 1.2  
**Last Updated:** 2026-03-18

---

## 1. System Overview

mydivelog.app consists of a TypeScript monorepo (API + web + admin) and a separate Flutter mobile repo. All clients communicate with the same API service.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  Clients                                    │
│  Web App (Next.js)   Admin App (Next.js)   Mobile App (Flutter) — Phase 2  │
│  mydivelog.app       admin.mydivelog.app   iOS + Android                   │
│                                            ← separate repo: mydivelog-mobile│
└──────┬──────────────────────┬──────────────────────┬────────────────────────┘
       │ HTTPS / REST         │ HTTPS / REST          │ HTTPS / REST
       │                      │ (admin endpoints only)│ (generated Dart client)
┌──────▼──────────────────────▼──────────────────────▼────────────────────────┐
│                              API Service                                    │
│                     Node.js + TypeScript + Fastify                          │
│                        Deployed on Vercel (serverless)                      │
└──────┬──────────────────────────────────────┬───────────────────────────────┘
       │                                      │
┌──────▼──────┐                  ┌────────────▼─────────┐
│  Supabase   │                  │        Stripe        │
│  PostgreSQL │                  │   Subscription Mgmt  │
│  + Auth     │                  └──────────────────────┘
│  + Storage  │
└─────────────┘
```

---

## 2. Services

### 2.1 API Service

- **Runtime:** Node.js 20 LTS
- **Language:** TypeScript
- **Framework:** Fastify (preferred over Express for performance and schema validation)
- **Deployment:** Vercel Serverless Functions
- **Monorepo path:** `apps/api`
- **Base URL:** `api.mydivelog.app`

Responsibilities:
- All business logic
- Auth token validation (JWT from Supabase Auth)
- Database queries via Prisma ORM
- Stripe webhook handling
- Dive site moderation logic
- File upload handling (delegating to Supabase Storage)

### 2.2 Web Frontend

- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Deployment:** Vercel (separate Vercel project, root directory: `apps/web`)
- **Monorepo path:** `apps/web`
- **URL:** `mydivelog.app`

Responsibilities:
- All user-facing UI
- Calls the API service for all data (no direct DB access)
- Handles OAuth redirect flows for Google and Apple sign-in
- Client-side state management via React Query (TanStack Query)

### 2.3 Admin Application

- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Deployment:** Vercel (separate Vercel project, root directory: `apps/admin`)
- **Monorepo path:** `apps/admin`
- **URL:** `admin.mydivelog.app`

The admin panel is a fully independent Next.js application within the monorepo but deployed as its own Vercel project. It operates against the **production database** via the same API service, using the admin-scoped endpoints under `/v1/admin/*`.

Responsibilities:
- Dive site submission moderation (review, approve, reject)
- User account management (view, suspend, delete)
- Platform metrics and health dashboard
- Manual subscription overrides

**Key separation rationale:**
- Admin code is never bundled into or accessible from the user-facing app
- Independent Vercel project — admin can be updated or rolled back without touching `apps/web`
- Separate auth surface — admin users authenticate through the same Supabase Auth but admin access is enforced by `role: ADMIN` on the API; a non-admin JWT will receive `403` on all `/admin/*` routes regardless of how it was obtained
- Can be IP-restricted at the Vercel or DNS level as an additional hardening measure

### 2.4 Mobile App (Phase 2)

- **Framework:** Flutter
- **Language:** Dart
- **Deployment:** iOS App Store + Google Play via EAS Build (Expo Application Services equivalent: Codemagic or GitHub Actions + Fastlane)
- **Repo:** `mydivelog-mobile` — **separate repository**, not part of the monorepo
- **API client:** Generated Dart client from the OpenAPI spec using `openapi-generator` (`dart-dio` target)

The mobile app lives in its own repo because Dart cannot consume TypeScript packages — the monorepo's shared `@repo/types` package provides no benefit to a Flutter project. The API contract is maintained via the OpenAPI spec (`API_SPEC.md`); the Dart client is regenerated whenever the spec changes.

**Why Flutter over React Native:**
- Existing Dart/Flutter familiarity reduces ramp-up time
- Superior cross-platform UI consistency and performance
- No benefit lost — the TypeScript monorepo shares nothing with a React Native app that wouldn't also need to be manually bridged

---

## 3. Infrastructure

### 3.1 Database — Supabase (PostgreSQL)

- **Provider:** Supabase (managed PostgreSQL)
- **ORM:** Prisma
- **Connection pooling:** PgBouncer (via Supabase connection string in transaction mode)
- **Migrations:** Prisma Migrate

Supabase is used for:
- PostgreSQL database hosting
- Auth (OAuth provider management, JWT issuance)
- Storage (file uploads: cert card images, dive computer files)
- Row Level Security (RLS) policies as an additional safety layer

### 3.2 Authentication — Supabase Auth

- Google OAuth 2.0 and Sign in with Apple configured in Supabase Auth dashboard
- Supabase issues a JWT on successful OAuth
- API validates JWT on every request using Supabase's JWT secret
- User record created in `users` table on first login (via `auth.users` trigger or API webhook)

### 3.3 Payments — Stripe

- Stripe Checkout for subscription initiation
- Stripe Customer Portal for self-serve plan management / cancellation
- Webhooks consumed by the API to sync subscription state:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Subscription tier stored in `users.subscription_tier` (`free` | `pro`)

### 3.4 File Storage — Supabase Storage

Used for:
- Certification card image uploads (Pro users)
- Dive computer import files (UDDF/UDCF) — processed then deleted
- Future: dive photo uploads

Bucket structure:
```
/certs/{user_id}/{filename}
/imports/{user_id}/{filename}   ← temporary, deleted after processing
```

### 3.5 Email — Resend (or Postmark)

Transactional email for:
- Dive site submission approved/rejected notifications
- Subscription confirmation / renewal receipts
- Account deletion confirmation

---

## 4. Repo Structure

### 4.1 TypeScript Monorepo — `mydivelog`

The API, web app, and admin app live in a single **pnpm + Turborepo monorepo**. Each app is deployed as a separate Vercel project pointing to its subdirectory, giving fully independent deployment pipelines with the benefits of shared code and atomic cross-app changes.

```
mydivelog/                         ← GitHub repo: mydivelog/mydivelog
├── apps/
│   ├── api/                       ← Fastify API → api.mydivelog.app
│   ├── web/                       ← Next.js user app → mydivelog.app
│   └── admin/                     ← Next.js admin app → admin.mydivelog.app
├── packages/
│   ├── types/                     ← @repo/types — shared TS interfaces & enums
│   ├── typescript-config/         ← @repo/typescript-config — shared tsconfig bases
│   └── eslint-config/             ← @repo/eslint-config — shared lint rules
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

Each Vercel project is configured with its root directory set to the relevant `apps/*` subdirectory. Vercel's **Skipping Unaffected Projects** feature (powered by Turborepo's package graph) automatically skips builds for apps whose code and dependencies haven't changed.

The `@repo/types` package exports shared TypeScript interfaces and enums — particularly API request/response shapes — consumed by all three apps as raw TypeScript source (Just-in-Time compilation, no build step required per package).

### 4.2 Flutter Mobile Repo — `mydivelog-mobile`

The mobile app lives in a **separate GitHub repo** (`mydivelog/mydivelog-mobile`). It cannot benefit from the TypeScript monorepo's shared packages since it is written in Dart.

```
mydivelog-mobile/                  ← GitHub repo: mydivelog/mydivelog-mobile
├── lib/
├── generated/
│   └── api_client/                ← Generated Dart client from OpenAPI spec
├── pubspec.yaml
└── README.md
```

The API contract is maintained via the OpenAPI spec. The Dart client is regenerated using `openapi-generator` (target: `dart-dio`) whenever the API spec changes. This keeps the mobile app's type safety in sync with the API without manual effort.

---

## 5. Environments

| Environment | API URL | Web URL | Admin URL | Database |
|---|---|---|---|---|
| Development | `localhost:3001` | `localhost:3000` | `localhost:3002` | Local Supabase (Docker) |
| Staging | `api-staging.mydivelog.app` | `staging.mydivelog.app` | `admin-staging.mydivelog.app` | Supabase staging project |
| Production | `api.mydivelog.app` | `mydivelog.app` | `admin.mydivelog.app` | Supabase production project |

> **Note:** The admin app has no staging environment that points to the staging database for routine use. Admin work in staging is done locally. The staging admin deployment (`admin-staging`) exists only for testing admin app UI changes before promoting to production — it still points to the **production API and database**, matching the production admin app's behaviour exactly.

---

## 6. Security Considerations

- All API endpoints require a valid Supabase JWT except auth callback routes
- User can only read/write their own data (enforced at API layer + Supabase RLS)
- All `/v1/admin/*` routes are protected by a dedicated `requireAdmin` middleware that checks `role: ADMIN` — a valid user JWT without admin role receives `403`
- The admin application (`admin.mydivelog.app`) is a separate Vercel project and can be further hardened:
  - **IP allowlist** via Vercel's project settings or Cloudflare Access — restrict to known office/VPN IPs
  - **Cloudflare Access** policy requiring an additional identity check (e.g. email domain restriction) before the app even loads
- The admin app has no direct database access — all operations go through the API's admin endpoints, maintaining a single auditable data access layer
- Stripe webhook signature verification on all incoming webhook events
- File uploads: type validation, size limits, virus scanning (ClamAV or Supabase built-in if available)
- Rate limiting on API via Vercel Edge or a Fastify rate-limit plugin
- CORS restricted to `mydivelog.app`, `staging.mydivelog.app`, and `admin.mydivelog.app`

---

## 7. Future Considerations (Phase 2+)

- Mobile app: Flutter (`mydivelog-mobile` repo), consuming the same API via a generated Dart client from the OpenAPI spec
- OpenAPI spec generation: add `fastify-swagger` to the API to auto-generate the spec from route definitions, feeding the Dart client generator
- Third-party API access: API key issuance, rate limiting per key
- CDN for dive site static assets
- Background job queue (e.g. Inngest or Trigger.dev) for dive computer file processing
- Read replica for analytics queries if DB load grows

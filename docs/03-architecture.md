# Architecture

## Shape

```
                    ┌──────────────────────────────────────────┐
   Browser ───────► │  web        Next.js  mydivelog.app       │
                    │             marketing + logged-in portal │
                    └───────────────────┬──────────────────────┘
                    ┌───────────────────┴──────────────────────┐
   Staff  ────────► │  admin      Next.js  admin.mydivelog.app │
                    └───────────────────┬──────────────────────┘
                                        │  HTTPS / REST + OpenAPI
   Flutter ─────────────────────────────┤  (iOS, Android, macOS, Windows)
   (offline-first, local SQLite)        │
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │  api        NestJS   api.mydivelog.app   │
                    │  stateless, horizontally scalable        │
                    └──────┬───────────────────────┬───────────┘
                           │                       │
                    ┌──────▼───────┐        ┌──────▼──────────┐
                    │  Postgres    │◄───────┤  worker         │
                    │  + pg-boss   │ queue  │  imports, merge │
                    │    queue     │        │  exports, email │
                    └──────────────┘        └──────┬──────────┘
                                                   │
                                            ┌──────▼──────────┐
                                            │ Object storage  │
                                            │ profiles, files │
                                            │ media, exports  │
                                            └─────────────────┘
```

Four deployable units: `api`, `worker`, `web`, `admin`. One database. One bucket.

## Why This Shape

**`api` and `worker` are separate processes sharing one codebase.** A 4.6 MB UDDF parse
producing 20k waypoints must never run inside a request. Import is upload → enqueue →
process → notify. Separating them also means import load can never take down the API, and
the two scale on different axes.

**`web` and `admin` are separate applications, not one app with a role check.** The admin
panel reads across all users by definition. Keeping it a separate deployment on a separate
hostname means a bug in the user-facing app cannot reach staff-only data paths, and the
admin app can be locked to an allowlist at the edge.

**pg-boss instead of Redis + BullMQ.** Postgres-backed job queue: one less service to run,
pay for, back up and monitor. Jobs are transactional with the data they touch — an import
batch and its job commit together or not at all. The job volume here (imports, exports,
emails) is in the hundreds-per-day range for a long time. Revisit if sustained throughput
exceeds ~50 jobs/sec; the swap to BullMQ is contained behind a queue interface.

**Stateless API.** No in-process session state, no local file writes. Every instance is
disposable, which is what makes the PaaS choice reversible.

## Repository Layout

A single monorepo. pnpm workspaces + Turborepo for the TypeScript side; Flutter sits inside
it as an ordinary directory with its own toolchain.

```
mydivelog/
├── apps/
│   ├── api/              NestJS  — HTTP, auth, controllers
│   ├── worker/           Node    — pg-boss consumers
│   ├── web/              Next.js — mydivelog.app
│   ├── admin/            Next.js — admin.mydivelog.app
│   └── mobile/           Flutter — iOS, Android, macOS, Windows
├── packages/
│   ├── db/               Prisma schema, migrations, seeds, typed client
│   ├── contracts/        Zod schemas → OpenAPI → generated TS + Dart clients
│   ├── domain/           Pure dive logic: units, merge rules, derived stats
│   ├── importers/        One module per source format
│   ├── exporters/        One module per target format
│   └── ui/               Shared React components for web + admin
├── infra/                Terraform + Fly configs + deploy scripts
├── fixtures/             Golden test data (redacted real exports)
└── docs/
```

### The two packages that matter most

**`packages/domain`** is pure functions, zero I/O, zero framework. Unit conversion, dive
identity/matching, field-level merge precedence, derived statistics, dive numbering. It is
the part most likely to be subtly wrong and it must be testable in milliseconds without a
database. Everything else is plumbing around it.

**`packages/contracts`** is the single source of truth for the API surface. Zod schemas
generate the OpenAPI document, which generates both the TypeScript client (web, admin) and
the Dart client (Flutter). The Flutter app never hand-writes a model. A breaking API change
fails the build in four places at once, which is exactly what you want.

## Technology Choices

| Layer | Choice | Why |
|---|---|---|
| API | NestJS (TypeScript) | Structure that survives a growing codebase; first-class DI for testability; OpenAPI generation built in |
| ORM | Prisma | Best-in-class migrations and typed client; the schema file doubles as documentation |
| Database | PostgreSQL 16+ | JSONB for raw source payloads, PostGIS-lite via `earthdistance` or PostGIS proper for site clustering, strong constraints |
| Queue | pg-boss | No extra infrastructure; transactional with the data |
| Web / Admin | Next.js (App Router) | SSR for the marketing site's SEO, React for the app; one framework for both |
| Apps | Flutter + Drift (SQLite) | One codebase across iOS/Android/macOS/Windows; Drift is the mature, maintained local-database choice with strong migration support |
| Object storage | S3-compatible (Cloudflare R2) | Zero egress fees — decisive once dive photos exist |
| Auth | OIDC (Google, Apple) + email magic link | No password storage, ever. Apple Sign-In is mandatory on iOS if Google is offered. Magic link covers divers who want neither. |
| Payments | Stripe Checkout + Customer Portal | Do not build billing UI |
| Errors | Sentry | API, web, admin, and Flutter in one project group |
| Email | Resend | Transactional only at launch |

## Boundaries And Rules

1. **Only `packages/db` touches the database.** Apps import repositories, never raw Prisma.
2. **Only `packages/contracts` defines the API shape.** Controllers validate against it;
   they don't declare their own types.
3. **`packages/domain` has no imports from anything else in the repo.** If domain logic
   needs data, it is passed in. This is enforced by lint rule, not convention.
4. **Importers produce `DiveObservation[]`. They never write to the database.** Parsing and
   persistence are separate concerns and separately testable — see
   [Import & Merge Engine](./05-import-merge-engine.md).
5. **Every user-owned query is scoped by `user_id` at the repository layer**, not by the
   caller remembering to. Ownership is a property of the data access layer.

## Scaling Path

Deliberately lean now, with the expensive-to-reverse decisions made correctly up front.

| Pressure | Response | Requires rewrite? |
|---|---|---|
| More traffic | More `api` machines; it's stateless | No |
| Import backlog | More `worker` machines | No |
| DB read load | Read replica; route reporting queries to it | No |
| DB write load | Partition `dives` and `change_log` by `user_id` | No — planned for in the schema |
| Profile storage growth | Already in object storage, effectively unbounded | No |
| Leaving Fly.io | Everything is a container; deploy to Cloud Run / ECS | No |
| Global latency | CDN for web/admin; API read replicas per region | Not for v1 |

The three decisions that would be genuinely expensive to reverse are all made now:
**SI storage units**, **field-level provenance**, and **profiles outside the relational
store**. Everything else is a redeploy.

See [ADR index](./decisions/) for the reasoning behind individual choices.

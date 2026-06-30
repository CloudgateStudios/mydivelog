# Technology Decisions

This document records stack and provider choices for MyDiveLog. Decisions should optimize for a public launch, low operational overhead, clear security boundaries, and the ability to move from admin to web to mobile without replatforming.

## Decision Status

Use these statuses:

- `Proposed`: recommended, but not yet confirmed.
- `Decided`: confirmed direction.
- `Deferred`: intentionally later.
- `Rejected`: considered and intentionally not chosen.

## Decision Principles

- Prefer boring, well-supported technology over novelty.
- Prefer fewer dependencies when the implementation cost stays reasonable.
- Keep the database and API portable.
- Avoid provider features that make future migration painful unless they buy major speed or safety.
- Separate public web, admin, API, database, and background processing concerns clearly.
- Design for public launch from day one: backups, exports, deletion, audit logs, and privacy controls matter.

## Current Decisions

| Area | Decision | Status | Notes |
| --- | --- | --- | --- |
| Product launch target | Public usable web launch | Decided | Not internal-only or private beta-only. |
| App sequence | Admin, website, Flutter mobile/desktop | Decided | API/database/import foundation comes first. |
| Admin deployment | Separate app/deployment | Decided | Prefer a staff-only subdomain and stricter access controls. |
| Customer auth | Direct Google and Apple OAuth/OpenID Connect | Decided | No MyDiveLog-managed passwords for v1. |
| Admin permissions | Read-only for user-owned dive data | Decided | Staff can inspect and add support notes, not edit logs. |
| Core platform provider | Full GCP Lean | Decided | Start with Cloud Run, Cloud SQL shared-core, Cloud Storage, Cloud Tasks, Secret Manager, and Cloud Logging/Monitoring. |
| Primary data store | PostgreSQL on Cloud SQL | Decided | Start lean with shared-core; revisit sizing and HA after real usage appears. |
| DNS | Hover registrar with Cloud DNS authoritative DNS | Decided | Keep registration and renewal at Hover; change nameservers to Cloud DNS so records live with GCP infrastructure. |
| Repository shape | Monorepo | Decided | Top-level folders such as `api`, `web`, `admin`, `app`, `docs`, `design`, `packages`, and `infra`. |
| Web app | Next.js on Cloud Run | Decided | Public web and logged-in app. |
| Admin app | Separate Next.js app on Cloud Run | Decided | Separate app within monorepo, separate deployment/staff subdomain. |
| Backend runtime/framework | TypeScript/Node with NestJS | Decided | Strong structure, dependency injection, validation, testing, and OpenAPI support. |
| API style | REST JSON with OpenAPI | Decided | Current docs assume this. |
| Database access | Prisma | Decided | Use Prisma schema/migrations/client with PostgreSQL on Cloud SQL. |
| Cloud SQL launch size | `db-g1-small` production, `db-f1-micro` staging/dev | Decided | Lean but less tiny for production; revisit dedicated-core/HA later. |
| Async jobs | Cloud Tasks | Decided | Best first fit for command-style jobs: import, export, deletion, retries. |
| Infrastructure as code | Terraform | Decided | GCP resources should be reproducible. |
| CI/CD | GitHub Actions | Decided | Build, test, migrate, and deploy apps/services. |
| Package manager/task runner | pnpm workspaces with Turborepo | Decided | Fast monorepo installs, workspace linking, task orchestration, and caching. |
| Auth session strategy | HttpOnly cookie sessions for web/admin; access/refresh tokens for mobile/API clients | Decided | Safer browser default; token model for mobile/API clients. |
| Cloud Run service layout | Separate services per app/workload | Decided | `mydivelog-api-*`, `mydivelog-web-*`, `mydivelog-admin-*`, `mydivelog-worker-*`, plus specific jobs. |
| Preview environments | Web/admin preview services first | Decided | PR previews for web/admin on Cloud Run using staging API/DB initially; API previews later if needed. |
| OAuth/session libraries | Passport.js/NestJS Passport plus OpenID client support | Decided | Use maintained OAuth/OIDC libraries; keep provider linking/session logic in our API. |
| OpenAPI generation | NestJS Swagger decorators | Decided | Generate OpenAPI from DTOs/controllers and use generated clients for web/admin. |
| Terraform layout | Shared modules plus environment roots | Decided | `infra/modules/*` and `infra/envs/{staging,prod}`. |
| Flutter local persistence | Deferred until mobile phase | Deferred | Drift + SQLite is the current preferred option, but re-evaluate when mobile begins. |
| Sync conflict strategy | Field-level merge plus explicit conflict resolution | Decided | Add concrete use cases and examples before mobile implementation. |
| Dive computer profile imports | Deferred until after v1 | Decided | Spreadsheet/CSV first; reserve model space for future time-series profile samples. |
| Canonical dive sites | Model from day one, workflow later | Decided | Add canonical tables/link fields now; defer public directory/moderation until after v1. |
| Observability | GCP-native for v1 | Decided | Cloud Logging, Monitoring, and Error Reporting first. |
| Mobile framework | Flutter | Proposed | Desired for cross-platform mobile/desktop after web launch. |

## Decision 1: Core Platform Provider

### What We Need

For the first public release, the platform needs to run:

- API service.
- Public web app.
- Separate admin app.
- Background worker for imports, exports, and future media processing.
- PostgreSQL database.
- Object storage for imports, exports, and future media.
- Staging and production environments.
- Ideally preview deployments.

### Shortlist

#### Full GCP

Status: `Decided`

Why it fits:

- One primary cloud provider for hosting, API, workers, storage, secrets, queues, logging, monitoring, IAM, and billing.
- Cloud Run can host the API, worker services, jobs, and potentially web/admin apps as containers.
- Cloud Storage handles imports, exports, and future media.
- Cloud Tasks handles async job dispatch.
- Secret Manager, Cloud Logging, Error Reporting, Cloud Monitoring, and IAM are native.
- Cloud SQL for PostgreSQL keeps the database inside GCP with mature backup, networking, and operational controls.
- Simpler security and operations story than a Vercel + Neon + GCP split.

Possible initial shape:

- `www.mydivelog...`: public website and logged-in app on Cloud Run or Firebase Hosting backed by Cloud Run.
- `admin.mydivelog...`: separate admin app on Cloud Run, staff-only subdomain.
- `api.mydivelog...`: API service on Cloud Run.
- `worker`: Cloud Run jobs or worker service.
- Cloud SQL for PostgreSQL, starting with a lean shared-core instance.
- Cloud Storage.
- Cloud Tasks.
- Secret Manager.
- Cloud DNS, with Hover remaining the registrar.
- Cloud Logging, Monitoring, and Error Reporting.

Risks:

- Frontend deployment and preview environments are less effortless than Vercel, especially if the web app is Next.js-heavy.
- Cloud SQL is more traditional managed database infrastructure. It is excellent, but low-traffic costs can be higher than serverless Postgres because instances are sized and running rather than scaling to zero like Neon.
- More GCP IAM/networking setup up front.
- If we want Vercel-like preview workflows, we need to build or configure more of that ourselves.

Cost notes:

- Cloud Run is usage-based and has a free tier, so API and worker compute can be very cost-efficient at low traffic.
- Cloud SQL pricing includes CPU, memory, storage, networking, and instance charges; high availability and replicas add cost. Start lean, then revisit sizing and HA after real usage appears.
- Cloud Storage pricing is based on storage, processing, and network usage, which is a natural fit for imports/exports and future media.

#### Vercel + Neon + GCP

Status: `Proposed`

Why it fits:

- Matches known provider experience, which reduces setup and operational friction.
- Vercel is a strong fit for the public website, logged-in web app, admin app, preview deployments, custom domains, and fast frontend iteration.
- Neon is a strong fit for managed PostgreSQL, especially with serverless-friendly connection pooling and branching for preview/test workflows.
- GCP fills the backend gaps cleanly with Cloud Run services, Cloud Run jobs, Cloud Storage, Pub/Sub or Cloud Tasks, Secret Manager, Cloud Logging, and Cloud Monitoring.
- Keeps the database and API portable because the app still targets PostgreSQL and containerized services.

Recommended responsibility split:

- Vercel: public website and logged-in web app.
- Vercel: separate admin frontend project or app, deployed to a staff-only subdomain.
- GCP Cloud Run service: API if we want a long-running containerized API from day one.
- GCP Cloud Run jobs or worker service: imports, exports, account deletion, and future media processing.
- Neon: PostgreSQL.
- GCP Cloud Storage: import files, export files, and future media.
- GCP Pub/Sub or Cloud Tasks: async job dispatch.
- GCP Secret Manager: provider secrets and backend service secrets.

Important caveat:

Do not put every backend workload in Vercel Functions by default. Vercel Functions are excellent for frontend-adjacent server work, but the platform has request payload and execution-duration limits. Imports, exports, future media processing, and account deletion are better modeled as asynchronous jobs on GCP.

Risks:

- More provider surface area than Render or pure GCP.
- Need clear deployment boundaries so API ownership does not become split across too many runtimes.
- Cross-provider networking and secrets need discipline.
- Need to decide whether the primary API lives on GCP Cloud Run or as Vercel Functions. For MyDiveLog, Cloud Run is the cleaner long-term API home.

#### Render

Status: `Option`

Why it fits:

- Supports web services, private services, background workers, cron jobs, managed PostgreSQL, Redis-compatible storage, previews, logs, metrics, custom domains, TLS, and infrastructure-as-code through `render.yaml`.
- Lower operational burden than raw AWS/GCP/Azure.
- Good match for a containerized API, worker, public web app, and separate admin app.
- Private networking between services helps keep admin/API/internal services cleaner.

Risks:

- Less cloud-provider breadth than AWS/GCP/Azure.
- Some advanced compliance, networking, and global scale needs may eventually require migration or hybrid services.
- Object storage would likely be external, such as Cloudflare R2 or S3.

#### Fly.io

Status: `Option`

Why it fits:

- Strong container/app platform.
- Good fit when geographic placement and edge-ish app deployment matter.
- Can run long-lived services and workers.

Risks:

- More infrastructure-shaped than Render.
- PostgreSQL and operations require more comfort with platform details.
- Might be more than we need for the first public launch.

#### Vercel + External Backend Platform

Status: `Option`

Why it fits:

- Excellent public web app and preview deployment story, especially for Next.js.
- Strong fit for marketing/public pages and logged-in web UX.

Risks:

- We still need a durable API/worker/database platform elsewhere or must accept serverless constraints.
- Splitting web hosting and backend hosting adds provider surface area.

#### Railway

Status: `Option`

Why it fits:

- Fast developer experience for services and databases.
- Useful for early prototypes.

Risks:

- Need more review before choosing it for a public production launch.
- May be less appealing if we want clearer long-term operational boundaries.

#### AWS Directly

Status: `Option`

Why it fits:

- Most complete long-term platform: RDS, S3, ECS/Fargate, CloudFront, SQS, Secrets Manager, CloudWatch, IAM.
- Strong portability and mature operational primitives.

Risks:

- More setup and operations overhead.
- ECS/Fargate or Lambda-based setups are viable but slower to bootstrap.

### Recommendation

Choose **Full GCP Lean** for the first public release.

Rationale:

- One provider gives simpler IAM, secrets, logging, monitoring, billing, and operational boundaries.
- The monthly model is acceptable for launch.
- Cloud Run and Cloud Storage keep compute/storage costs low early.
- Cloud SQL is the main fixed cost, and starting lean keeps that manageable.
- The app remains portable because it targets containerized services and PostgreSQL.

Initial shape:

- `www.mydivelog...`: public website and logged-in app on Cloud Run or Firebase Hosting backed by Cloud Run.
- `admin.mydivelog...`: separate admin app on Cloud Run, staff-only subdomain.
- `api.mydivelog...`: API service on Cloud Run.
- `worker`: Cloud Run jobs or worker service.
- Cloud SQL for PostgreSQL, shared-core lean launch size.
- Cloud Storage for imports, exports, and future media.
- Cloud Tasks for async job dispatch.
- Secret Manager for backend secrets.
- Cloud Logging, Monitoring, and Error Reporting.

## Decision 2: Repository And Application Stack

Status: `Decided`

### Monorepo

Use a monorepo so shared types, generated API clients, Prisma schema, migrations, docs, infrastructure, and app code evolve together.

Proposed top-level folders:

- `api`: NestJS API service.
- `web`: public website and logged-in web app.
- `admin`: separate staff admin app.
- `app`: future Flutter mobile/desktop app.
- `packages`: shared TypeScript packages, generated clients, validation schemas, and test utilities.
- `infra`: Terraform.
- `docs`: planning and architecture docs.
- `design`: product/design references, tokens, and brand assets.
- `pnpm-workspace.yaml`: workspace definition.
- `turbo.json`: task pipeline and caching.

Why monorepo fits:

- Easier shared contracts between API, web, admin, and future mobile clients.
- Easier coordinated schema/API/frontend changes.
- One CI pipeline can validate the full system.
- Keeps early project navigation simple while boundaries remain explicit.

Risk:

- Monorepos need good workspace scripts and CI filtering so builds do not become slow.

Use pnpm workspaces with Turborepo for package management and monorepo task orchestration.

### Web And Admin

Use two separate Next.js apps:

- `web`: public homepage, logged-in user app, public dive pages.
- `admin`: read-only staff/admin tooling.

Both should be containerized and deployed separately on Cloud Run. Keeping them in one monorepo does not mean they are one app; it means they share repo tooling and selected packages while deploying independently.

### Backend

Use TypeScript/Node with NestJS for the API.

Why NestJS fits:

- Strong module boundaries match the planned domain modules.
- Good support for dependency injection, guards, interceptors, validation, testing, and OpenAPI.
- Works naturally as a long-running Cloud Run container.
- Familiar enough in the Node ecosystem to avoid inventing structure.

Tradeoff:

- More framework than Fastify/Hono, but the structure is useful for an API with auth, imports, admin, sync readiness, and future mobile clients.

### Database Access

Use Prisma for schema, migrations, and database client.

Why Prisma fits:

- Good developer experience.
- Clear schema representation.
- Migration workflow is straightforward.
- Works well with PostgreSQL.

Watchouts:

- Keep performance-sensitive queries reviewable.
- Use explicit indexes and constraints, especially for user-owned dive numbers, import rows, and sync metadata.
- Be willing to use raw SQL for specialized queries if needed.

### Async Jobs

Use Cloud Tasks first.

Initial job types:

- Spreadsheet import parse/commit.
- Export generation.
- Account deletion workflow.
- Future media processing.

Use Pub/Sub later if we need event fan-out, analytics pipelines, notifications, or multiple independent subscribers.

### Infrastructure And CI/CD

Use Terraform for infrastructure and GitHub Actions for CI/CD.

Terraform should manage:

- Cloud Run services and jobs.
- Cloud SQL.
- Cloud Storage buckets.
- Cloud Tasks queues.
- Secret Manager secrets or secret references.
- Cloud DNS zone/records.
- Service accounts and IAM.
- Logging/monitoring basics where practical.

GitHub Actions should run:

- Formatting and linting.
- Unit tests.
- Integration tests.
- Prisma migration checks.
- Docker builds.
- Terraform plan for infrastructure changes.
- Deploys to staging and production.

### Auth Session Strategy

Recommended:

- Browser web/admin: secure HttpOnly SameSite cookies backed by server-side session or refresh-token rotation handled by the API.
- Mobile/API clients: short-lived access token plus refresh token stored in platform secure storage.

Why:

- Browser tokens stored in JavaScript-accessible storage are more exposed to XSS.
- HttpOnly cookies reduce token exposure for web/admin users.
- Mobile still benefits from access/refresh tokens because cookie semantics are not as ergonomic across mobile clients.

Session lifetimes should start conservative:

- Browser access/session lifetime: about 15 minutes.
- User refresh/session lifetime: about 30 days with rotation.
- Admin refresh/session lifetime: 8-12 hours with stricter staff-role checks.

### Cloud Run Layout

Use one Cloud Run service per deployable app or long-running worker:

- `mydivelog-api-prod`
- `mydivelog-web-prod`
- `mydivelog-admin-prod`
- `mydivelog-worker-prod`
- `mydivelog-api-staging`
- `mydivelog-web-staging`
- `mydivelog-admin-staging`
- `mydivelog-worker-staging`

Use separate Cloud Run jobs for specific background workflows:

- `mydivelog-import-job-prod`
- `mydivelog-export-job-prod`
- `mydivelog-delete-account-job-prod`

Domains:

- `mydivelog.com`
- `www.mydivelog.com`
- `api.mydivelog.com`
- `admin.mydivelog.com`
- `staging.mydivelog.com`
- `api-staging.mydivelog.com`
- `admin-staging.mydivelog.com`

### Preview Environments

Start with ephemeral preview services for web/admin only:

- PRs run formatting, linting, type checks, tests, and builds.
- Web/admin PRs deploy Cloud Run preview services like `mydivelog-web-pr-123` and `mydivelog-admin-pr-123`.
- Preview web/admin services point at the staging API and staging database.
- Do not create per-PR Cloud SQL instances initially.

Add API preview services only when API changes need full integration preview. Add isolated preview databases only if schema-change review demands it.

## Upcoming Decisions

Work through these after the core platform provider:

1. Flutter app architecture and local database, when mobile phase begins.

## Decision 3: API, Auth, Infra, And Deferred Mobile Choices

Status: `Decided`

### OAuth And Sessions

Use maintained OAuth/OpenID Connect libraries rather than hand-rolling provider protocol details.

Initial stack:

- `passport`
- `@nestjs/passport`
- `passport-google-oauth20`
- `openid-client` or a maintained Apple strategy for Sign in with Apple
- custom session, refresh-token, provider-linking, and staff-role logic in the API

Session model:

- Browser web/admin clients use secure HttpOnly SameSite cookies.
- Future mobile/API clients use short-lived access tokens plus rotating refresh tokens.
- Store only hashed opaque session/refresh tokens server-side.
- Use separate session kind or cookie name for admin sessions.
- Require re-authentication for sensitive actions such as account deletion, identity linking, and export requests.
- Use CSRF tokens plus Origin/Referer checks for state-changing browser requests.

Starting lifetimes:

- Browser access/session lifetime: about 15 minutes.
- User refresh/session lifetime: about 30 days with rotation.
- Admin refresh/session lifetime: 8-12 hours with stricter staff-role checks.

Why:

- Fits NestJS cleanly.
- Keeps direct Google/Apple OAuth without a managed auth provider.
- Lets MyDiveLog control Apple relay behavior, account linking, staff roles, session rotation, and audit logging.

### OpenAPI

Generate OpenAPI from NestJS controllers and DTOs.

Initial stack:

- `@nestjs/swagger`
- DTO classes with validation decorators
- generated `openapi.json` in CI
- generated TypeScript clients for `web` and `admin`

Rules:

- API DTOs should remain separate from Prisma persistence models.
- CI should fail on invalid OpenAPI output.
- Contract changes should be visible in pull requests.

### Terraform

Use shared Terraform modules and one root per environment.

Proposed shape:

```text
infra/
  modules/
    cloud-run-service/
    cloud-run-job/
    cloud-sql/
    cloud-storage-bucket/
    cloud-tasks-queue/
    secret-manager/
    cloud-dns/
    iam-service-account/
  envs/
    staging/
      main.tf
      variables.tf
      terraform.tfvars
    prod/
      main.tf
      variables.tf
      terraform.tfvars
```

Staging and production should be deliberately separate roots so plans are clear and environment drift is visible.

### Flutter Persistence

Defer the final decision until the mobile phase. The preferred option is still Drift + SQLite because the mobile app needs offline relational queries, migrations, joins, and a pending mutation queue.

Re-evaluate when mobile begins against:

- Drift + SQLite
- Isar
- Realm

### Dive Computer Profile Imports

Defer detailed dive computer profile imports until after the first public release.

For v1:

- Spreadsheet import.
- Generic CSV import.
- Schema should not block future profile data.

Later profile data can use a time-series table such as:

```text
dive_profile_samples:
  diveId
  elapsedSeconds
  depthMeters
  temperatureCelsius
  pressureBar
```

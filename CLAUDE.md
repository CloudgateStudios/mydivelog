# mydivelog — Monorepo

## What this is
mydivelog.app is a scuba dive logbook SaaS. This monorepo contains three apps and shared packages, all TypeScript. A separate Flutter repo (`mydivelog-mobile`) handles the mobile app.

## Repo structure
```
apps/
  api/       Fastify REST API → api.mydivelog.app
  web/       Next.js user app → mydivelog.app
  admin/     Next.js admin app → admin.mydivelog.app
packages/
  types/              @repo/types — shared interfaces & enums (raw TS, no build step)
  typescript-config/  @repo/typescript-config — shared tsconfig bases
  eslint-config/      @repo/eslint-config — shared lint rules
```

## Stack
- **Runtime:** Node.js 20 LTS
- **Language:** TypeScript throughout
- **Package manager:** pnpm with workspaces
- **Task runner:** Turborepo (`turbo.json` at root)
- **Database:** PostgreSQL via Supabase, ORM is Prisma (schema lives in `apps/api/prisma/schema.prisma`)
- **Auth:** Supabase Auth (Google OAuth + Sign in with Apple)
- **Payments:** Stripe (subscriptions, webhooks)
- **Storage:** Supabase Storage
- **Deployment:** Vercel — three separate projects, one per app

## Key commands
```bash
pnpm dev          # start all apps in parallel
pnpm build        # build all apps (Turborepo handles order)
pnpm lint         # lint all packages
pnpm typecheck    # tsc --noEmit across all packages
pnpm test         # run all tests
```

To run a single app:
```bash
pnpm --filter @repo/api dev
pnpm --filter @repo/web dev
pnpm --filter @repo/admin dev
```

## Planning docs
All planning documents live in `/docs`. Read these before making significant changes:

| File | Contents |
|---|---|
| `docs/PRD.md` | Product requirements, feature scope, freemium model |
| `docs/ARCHITECTURE.md` | System design, services, infrastructure |
| `docs/DATA_MODEL.md` | Full Prisma schema with design decisions |
| `docs/API_SPEC.md` | All API endpoints, request/response shapes |
| `docs/AUTH.md` | Auth flow, Supabase setup, JWT validation |
| `docs/ADMIN.md` | Admin app spec and security model |
| `docs/IMPLEMENTATION_PLAN.md` | Phased build plan with task checklists |
| `docs/GAP_ANALYSIS.md` | Field mapping from existing dive log spreadsheet |

## Shared types (`@repo/types`)
All API request/response interfaces and shared enums live in `packages/types/src`. Import as:
```typescript
import { Dive, Trip, User, SubscriptionTier } from '@repo/types'
```
This package exports raw TypeScript — no compilation needed. Changes here affect all three apps immediately.

## Prisma
Schema is at `apps/api/prisma/schema.prisma`. All migrations run from `apps/api`:
```bash
pnpm --filter @repo/api prisma migrate dev --name <migration-name>
pnpm --filter @repo/api prisma generate
```

## Environment variables
Each app has its own `.env.local` (not committed). See `.env.example` in each app directory for required vars. Never use the Supabase service role key in `apps/web` or `apps/admin` — it is API-only.

## Code conventions
- All values stored in metric units (meters, Celsius, kg) in the DB; conversion happens at the API response layer based on `user.unitPreference`
- Depth field: `maxDepthM`, temperature fields: `airTempC`, `surfaceTempC`, `bottomTempC`
- `diveTags` = structured characteristic tags (night, drift, wreck, wall, sunset); `tags` = user freeform tags
- `entryType` enum covers how the diver entered the water; separate from `diveTags`
- Two free-text fallback fields for unmatched sites: `locationFreeText` (broad destination) and `diveSiteFreeText` (specific site name)
- Subscription state is flattened onto the `users` table — there is no separate subscriptions table
- A dive can belong to at most one trip (`tripId` nullable FK); deleting a trip sets `tripId` to null on dives, never deletes them

## Mobile app
The Flutter mobile app is in a separate repo (`mydivelog-mobile`). It consumes `api.mydivelog.app` via a generated Dart client from the OpenAPI spec. Do not attempt to share TypeScript packages with it.

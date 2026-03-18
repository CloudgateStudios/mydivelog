# apps/api — Fastify API

## What this is
The REST API for mydivelog.app. All business logic lives here. Both the web app and admin app are clients of this API — neither has direct database access.

## Stack
- **Framework:** Fastify
- **Language:** TypeScript
- **ORM:** Prisma (schema at `prisma/schema.prisma`)
- **Database:** PostgreSQL via Supabase
- **Auth:** Supabase JWT validation on every request
- **Deployment:** Vercel Serverless Functions
- **Base URL:** `api.mydivelog.app`

## Structure
```
apps/api/
  prisma/
    schema.prisma      Full data model — source of truth
    migrations/        Prisma migration history
    seed.ts            Dive site seed data
  src/
    index.ts           Fastify server entry point
    middleware/
      auth.ts          JWT validation + user loading (authenticate)
      admin.ts         Admin role check (requireAdmin)
    routes/
      users.ts
      dives.ts
      trips.ts
      sites.ts
      gear.ts
      certifications.ts
      stats.ts
      subscriptions.ts
      admin/
        submissions.ts
        users.ts
        metrics.ts
    services/
      auth.service.ts    provisionUser on first login
      stripe.service.ts  Checkout, portal, webhook handling
      email.service.ts   Transactional email via Resend
      import.service.ts  Dive computer UDDF/UDCF parsing
    lib/
      prisma.ts          Prisma client singleton
      supabase.ts        Supabase admin client
      stripe.ts          Stripe client
```

## Auth pattern
Every protected route uses the `authenticate` preHandler. It validates the Supabase JWT, loads the `User` record from the DB, and attaches it to `request.appUser`. Admin routes additionally use `requireAdmin`.

```typescript
fastify.get('/v1/dives', { preHandler: authenticate }, handler)
fastify.get('/v1/admin/users', { preHandler: [authenticate, requireAdmin] }, handler)
```

## Feature gating pattern
Free tier limits are enforced in route handlers before writing to the DB:
```typescript
if (user.subscriptionTier === 'FREE' && diveCount >= 50) {
  return reply.code(403).send({ error: { code: 'DIVE_LIMIT_REACHED' } })
}
```

## Unit conversions
All values are stored in metric. Convert incoming imperial values before writing. Convert outgoing values based on `request.appUser.unitPreference` before responding. Conversion utilities live in `src/lib/units.ts`.

## Stripe webhooks
The `/v1/subscriptions/webhook` route verifies the Stripe signature and updates `users` billing fields directly. There is no separate subscriptions table — all billing state is on the `users` record.

## Environment variables
See `.env.example`. Critical vars:
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — server-side only, never in client apps
- `DATABASE_URL` — PgBouncer connection (for runtime queries)
- `DIRECT_URL` — direct Supabase connection (for Prisma migrations only)
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`

## API reference
Full endpoint documentation is in `../../docs/API_SPEC.md`.

## Data model reference
Full Prisma schema rationale is in `../../docs/DATA_MODEL.md`.

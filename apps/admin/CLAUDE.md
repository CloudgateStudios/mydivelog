# apps/admin — Admin Application

## What this is
The internal admin panel for mydivelog.app. Deployed as a separate Vercel project but lives in the monorepo at `apps/admin`. It always operates against the **production API and database** — there is no admin staging environment that points to staging data.

Only users with `role: ADMIN` in the database can access this app. The middleware verifies this on every request by calling `GET /v1/users/me` and checking `role === 'ADMIN'`.

## Stack
- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Auth:** Supabase Auth (Google OAuth only — no Apple required)
- **Deployment:** Vercel (root directory: `apps/admin`, always points to `api.mydivelog.app`)
- **URL:** `admin.mydivelog.app`

## Structure
```
apps/admin/
  app/
    login/             Google sign-in only
    auth/callback/     OAuth callback
    unauthorized/      Shown to non-admin authenticated users
    (admin)/           Admin-only layout (sidebar + header)
      submissions/     Dive site moderation queue
      users/           User management
      metrics/         Platform metrics dashboard
  components/
    layout/            Admin sidebar, header
    submissions/       Moderation UI components
    users/             User management components
    metrics/           Charts and stats cards
  lib/
    supabase/          Same pattern as apps/web
    api/               Admin API client (typed, admin endpoints only)
  middleware.ts        Checks session AND role: ADMIN — hard redirects otherwise
```

## Critical: always production
`NEXT_PUBLIC_API_URL` is always `https://api.mydivelog.app` — even in the `admin-staging` deployment. This is intentional. Admin actions affect live data. Never point this app at a staging API.

## Auth and authorization
After OAuth callback, the middleware calls `GET /v1/users/me` with the session token. If `role !== 'ADMIN'`, redirect to `/unauthorized`. If no session, redirect to `/login`. This check runs on every page render via Next.js middleware.

To grant admin access, set the role directly in the database:
```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'your@email.com';
```
There is no UI for this — it must be done via Supabase dashboard or a migration script.

## Key pages and their API calls
| Page | Primary API calls |
|---|---|
| `/submissions` | `GET /v1/admin/submissions` |
| `/submissions/:id` | `GET /v1/admin/submissions/:id` |
| Approve | `POST /v1/admin/submissions/:id/approve` |
| Reject | `POST /v1/admin/submissions/:id/reject` |
| `/users` | `GET /v1/admin/users` |
| `/users/:id` | `GET /v1/admin/users/:id` |
| `/metrics` | `GET /v1/admin/metrics` |

## Environment variables
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_API_URL=https://api.mydivelog.app    # always production, never staging
```

## Security notes
- This app can be placed behind Cloudflare Access or a Vercel IP allowlist for additional hardening
- All destructive actions (user delete, subscription override) go through the API — the admin app never writes to the database directly
- See `../../docs/ADMIN.md` for full security model and hardening options

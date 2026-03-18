# apps/web — User-Facing Web App

## What this is
The user-facing Next.js application for mydivelog.app. All data comes from the API (`api.mydivelog.app`) — this app has no direct database access.

## Stack
- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Auth:** Supabase Auth (`@supabase/ssr`) — Google + Apple OAuth
- **Data fetching:** TanStack Query (`@tanstack/react-query`)
- **Deployment:** Vercel (root directory: `apps/web`)
- **URL:** `mydivelog.app`

## Structure
```
apps/web/
  app/
    (auth)/
      login/           Sign in with Google / Apple
      auth/callback/   OAuth callback route
    (app)/             Authenticated layout
      dashboard/       Stats overview
      dives/           Dive log list + new/edit/detail
      trips/           Trip list + detail
      sites/           Dive site search + detail
      gear/            Gear inventory
      certifications/  Cert records
      stats/           Analytics (advanced stats for Pro)
      settings/        Profile, units, subscription
    admin/             — NOT here, lives in apps/admin
  components/
    ui/                Generic UI components
    dives/             Dive-specific components
    trips/             Trip-specific components
    ...
  lib/
    supabase/
      client.ts        Browser Supabase client
      server.ts        Server Supabase client (for RSC + middleware)
    api/               API client functions (typed, using @repo/types)
  middleware.ts        Route protection — redirects unauthenticated users to /login
```

## Auth
Uses `@supabase/ssr` for cookie-based session management. The middleware checks for a valid session on all routes under `/(app)/`. After OAuth callback, the session is stored in httpOnly cookies automatically.

Never use the Supabase service role key here — only the anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`).

## API calls
All API calls go to `NEXT_PUBLIC_API_URL` (e.g. `https://api.mydivelog.app`). The access token from the Supabase session is passed as `Authorization: Bearer <token>` on every request. Use TanStack Query for all client-side data fetching.

## Freemium gating
When the API returns `403` with `code: DIVE_LIMIT_REACHED`, `GEAR_LIMIT_REACHED`, `CERT_LIMIT_REACHED`, or `PRO_REQUIRED`, show the upgrade prompt component. Do not gate features client-side only — the API is the source of truth.

## Unit display
Read `user.unitPreference` from the `/v1/users/me` response. Display depth as meters or feet, temperature as Celsius or Fahrenheit, weight as kg or lbs accordingly. The API returns values already converted to the user's preference.

## Key pages and their API calls
| Page | Primary API calls |
|---|---|
| `/dives` | `GET /v1/dives` |
| `/dives/new` | `POST /v1/dives`, `GET /v1/dive-sites` (autocomplete) |
| `/dives/:id` | `GET /v1/dives/:id` |
| `/trips` | `GET /v1/trips` |
| `/trips/:id` | `GET /v1/trips/:id` |
| `/sites` | `GET /v1/dive-sites` |
| `/gear` | `GET /v1/gear` |
| `/certifications` | `GET /v1/certifications` |
| `/dashboard` | `GET /v1/stats/summary` |
| `/stats` | `GET /v1/stats/advanced` (Pro) |
| `/settings/subscription` | `POST /v1/subscriptions/portal` |

## Environment variables
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_API_URL          # https://api.mydivelog.app (or localhost:3001 for dev)
```

## Full planning docs
- Product requirements: `../../docs/PRD.md`
- API endpoints: `../../docs/API_SPEC.md`
- Auth flow with code examples: `../../docs/AUTH.md`

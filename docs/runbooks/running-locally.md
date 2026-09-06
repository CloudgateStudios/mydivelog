# Runbook: running MyDiveLog locally

From a clean clone to a logbook with real dives in it. Three commands and a
sign-in link.

## Once

```bash
cp .env.example .env
pnpm install
```

`.env.example` is complete for local work — it points at the Docker Postgres
and MinIO, enables the development sign-in stub, and sets a local auth secret.
Nothing in it is a real credential.

## Every time

```bash
pnpm dev
```

Starts Postgres and MinIO in Docker, then the API (`:53001`), web
(`:53000`), admin (`:53002`) and worker, all watching for changes.

On a fresh database, apply the schema and the reference data first:

```bash
pnpm db:deploy    # migrations
pnpm db:seed      # tag taxonomy, agencies, gas mixes, regions
```

> The seed matters. Without it there are no system tags, so every diver gets
> a private copy of `shore` instead of the shared one.

## Load the real seed files

In a second terminal, with `pnpm dev` running:

```bash
pnpm demo
```

```
  spreadsheet-sample.csv   24 new,  0 merged into dives you already had
  uddf-sample.uddf          0 new,  6 merged into dives you already had

  24 dives in the logbook.
```

That is the whole product in two lines: 24 spreadsheet rows and 6 computer
dives become 24 dives, not 30, because six of them are the same dives twice.

It goes through the API over HTTP — upload, detect, parse, match, review,
commit — so a green run means the path a person takes works. Safe to re-run:
an identical file short-circuits to the batch that already exists.

## Sign in

There is no password. Ask for a link at http://localhost:53000/signin, then
find it in the API's output:

```
magic link for demo@mydivelog.invalid: http://localhost:53000/auth/verify?token=…
```

Paste it into the browser. Locally the link is logged rather than emailed,
because no mail provider is configured — set `RESEND_API_KEY` and `MAIL_FROM`
if you want it actually sent.

## What to look at

| | |
|---|---|
| http://localhost:53000 | Landing page |
| http://localhost:53000/logbook | Your dives, newest first |
| [?tag=shore&tag=night](http://localhost:53000/logbook?tag=shore&tag=night) | Two tags narrow rather than widen — one dive, not twenty-two |
| [?minDepthM=30](http://localhost:53000/logbook?minDepthM=30) | Depth bounds are metres in the URL whatever units you read them in |
| a dive from that list | Depth profile, fields, and where each value came from |
| http://localhost:53000/stats | Dives by year, depth and month — with the empty years drawn |
| http://localhost:53000/sites | Where you have dived, plotted from your own coordinates |
| http://localhost:53002 | Admin panel — imports, provenance, format health |
| http://localhost:53002/imports | Every row of an import: decision, score, what changed and why |

Filters live in the URL, so every one of those is a link you can share, and
saving a view is naming one. Switch to imperial in settings and the depth
filter offers 60 and 100 ft while the URL keeps metres — which is why a saved
view means one range rather than whatever the person opening it has set.

The dives dated 2026-03-05 and 2026-03-06 are the six the two files both
describe. Open one and the provenance panel shows the three fields the sources
genuinely disagreed on, and which one won.

The admin panel needs no sign-in locally: it is protected by Cloudflare Access
in deployed environments, and `.env.example` sets
`ADMIN_ACCESS_CHECK_DISABLED=true` so it is reachable here.

> **Re-running `pnpm demo` accumulates dives.** It is safe — an identical file
> short-circuits — but a database that has seen a dozen runs is not what a new
> user sees, and reasoning from one is how a site page came to look like it had
> merged two different dive sites. Reset before judging anything.

## Starting over

```bash
pnpm services:reset   # destroys the Docker volumes, including all data
pnpm db:deploy && pnpm db:seed && pnpm demo
```

## When something is wrong

**The API will not start.** It refuses to boot without `AUTH_ACCESS_SECRET`
rather than signing sessions with a default. `.env.example` sets one.

**Everything 500s with "table does not exist".** The migrations have not been
applied to the database you are pointed at — run `pnpm db:deploy`.

**Migrations seem to apply but nothing changes.** `prisma.config.ts` prefers
`DIRECT_DATABASE_URL` over `DATABASE_URL`, and it loads `.env` over anything
exported in your shell. If you are pointing at a scratch database, change both
in `.env` rather than exporting them.

**Profiles do not draw.** MinIO is not running, or the buckets were not
created. `pnpm services:up` does both.

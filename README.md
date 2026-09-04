# MyDiveLog

A digital dive logbook that consolidates a diver's scattered records — spreadsheets, dive
computer apps, vendor clouds — into one history they can trust and take with them.

**Status:** Phase 0 (foundations). No product features yet. See
[the implementation plan](./docs/README.md).

## Quick start

Requires [Node 24+](https://nodejs.org), [pnpm 11+](https://pnpm.io), and Docker.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` starts Postgres and MinIO in Docker, creates the storage buckets, then runs all
four applications.

| Service       | URL                    | Health        |
| ------------- | ---------------------- | ------------- |
| Web           | http://localhost:53000 | `/api/health` |
| API           | http://localhost:53001 | `/health`     |
| Admin         | http://localhost:53002 | `/api/health` |
| Worker        | http://localhost:53003 | `/health`     |
| Postgres      | `localhost:55432`      | —             |
| MinIO console | http://localhost:59001 | —             |

Ports sit outside the usual 3000/5432/9000 range because those collide with almost every
other local project. Every one is overridable in `.env`.

## Layout

```
apps/
  api/       NestJS  — HTTP, auth, controllers
  worker/    Node    — background jobs (imports, exports, email)
  web/       Next.js — mydivelog.app
  admin/     Next.js — staff tools
packages/
  domain/    Pure dive logic: units, merge rules, derived stats. No I/O.
fixtures/    Real-world test data, hazards deliberately intact
docs/        The implementation plan
```

## Commands

| Command                              | Does                              |
| ------------------------------------ | --------------------------------- |
| `pnpm dev`                           | Services + all apps in watch mode |
| `pnpm build`                         | Build everything                  |
| `pnpm test`                          | Run all tests                     |
| `pnpm lint` / `pnpm typecheck`       | Static checks                     |
| `pnpm format`                        | Apply Prettier                    |
| `pnpm spellcheck`                    | cspell across the repo            |
| `pnpm verify`                        | Everything CI runs                |
| `pnpm services:up` / `services:down` | Docker stack only                 |
| `pnpm services:reset`                | Destroy volumes and recreate      |
| `pnpm db:migrate`                    | Create and apply a migration from schema changes |
| `pnpm db:deploy`                     | Apply existing migrations (what deployed environments run) |
| `pnpm db:seed`                       | Reference data: agencies, tags, gas mixes, regions. Idempotent. |
| `pnpm db:demo`                       | Insert the worked merge example and print it |
| `pnpm db:studio`                     | Browse the database in a UI |
| `pnpm db:reset`                      | Drop, re-migrate, re-seed |
| `pnpm --filter @mydivelog/db test:integration` | Database-backed tests (needs `services:up`) |

## Seeing the data model work

There is no API or UI yet. To look at what Phase 1 built:

```bash
pnpm services:up      # Postgres and MinIO
pnpm db:deploy        # 31 tables
pnpm db:seed          # reference data
pnpm db:demo          # one dive, recorded twice, merged
pnpm db:studio        # browse it
```

`pnpm db:demo` inserts the worked example from
[the source data analysis](./docs/02-source-data-analysis.md): one real dive
that appears in both seed files, where each source holds fields the other lacks
and the two disagree about depth and gas. It prints the merged record and leaves
it in the database, so the provenance rows can be inspected in `pnpm db:studio`
— the part of the model hardest to judge from the schema alone.

## Conventions

- **Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org).**
  CI enforces it. The repo squash-merges, so a single-commit PR puts that commit's subject
  on `main`.
- **Store SI.** Metres, Celsius, seconds, kilograms, bar. Convert at the edges only.
- **`packages/domain` imports nothing.** No I/O, no framework, no workspace packages. Lint
  enforces it.
- **Never break a fixture to make a test pass.** The hazards in `fixtures/` are the point —
  see [fixtures/README.md](./fixtures/README.md).

## Where to read next

[`docs/README.md`](./docs/README.md) indexes the plan. If you read one thing, read
[the source data analysis](./docs/02-source-data-analysis.md) — every design decision
traces back to something in it.

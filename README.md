# MyDiveLog

A digital dive logbook that consolidates a diver's scattered records — spreadsheets, dive
computer apps, vendor clouds — into one history they can trust and take with them.

**Status:** Phase 0 (foundations). No product features yet. See
[the implementation plan](./docs/README.md).

## Quick start

Requires [Node 24+](https://nodejs.org), [pnpm 10+](https://pnpm.io), and Docker.

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

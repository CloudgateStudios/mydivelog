# Runbook: what CI costs, and why some jobs sit out

GitHub bills Actions minutes on private repositories, rounded up per job. A
full pass on this repository costs about **20 billable minutes**, which is
roughly 100 pull-request pushes a month on the Free tier's 2,000.

Measured over 25 runs:

| Job | Billed minutes |
|---|---|
| Container images (api, admin, web, worker) | **8.5** combined |
| Accessibility and Lighthouse | 4.8 |
| Lint, typecheck, test, build | 2.7 |
| Integration tests | 1.9 |
| Fixture integrity, secret scan, PR title, spell check | 4.0 combined |

Most of that was the four container builds re-running because somebody edited
a paragraph.

## What the `changes` job does

It compares the pull request's base and head, and sets three flags:

| Flag | True when | Gates |
|---|---|---|
| `code` | anything outside `docs/`, `.cspell/` and root `*.md` changed | lint/typecheck/test/build, integration tests, fixture integrity |
| `images` | a Dockerfile, any `package.json`, or a lockfile changed | the four container builds |
| `web` | `apps/web`, `apps/api`, `packages/{domain,contracts,db,importers}`, `e2e/` or the Playwright/Lighthouse config changed | Accessibility and Lighthouse |

The secret scan is deliberately never gated. It is a minute, and it is the one
whose absence would matter most.

## The two rules that keep this from becoming a hole

**Everything runs on `main`, always.** A filter that turns out to be too narrow
then costs one red build at merge instead of silence. That is the failure mode
worth designing against: a check that never runs protects nothing, and this
repository has already been bitten by it once — the API's integration tests
were excluded by a shell glob and nobody noticed for weeks, during which two
of them had gone stale against a status code the server no longer returned.

**The filters are generous, and the diff fails open.** Skipping a job that
would have passed saves nothing worth having, so each pattern errs wide. If
the comparison cannot be made at all, every flag is set to true and the whole
suite runs.

## Why `images` is narrow but still safe

A `.tsx` edit inside an app that already builds cannot break its container.
What can is the Dockerfile itself, the set of packages installed, or a new
workspace dependency that needs copying in — and that last one arrives as a
`package.json` change. Adding `@mydivelog/contracts` to the web app needed two
new `COPY` lines, and the filter catches exactly that shape.

## Changing the filters

`.github/workflows/ci.yml`, the `changes` job. The expressions are plain
`grep -E` against a file list, so they can be exercised without pushing:

```bash
printf 'apps/web/app/logbook/page.tsx\n' | grep -qE '^(apps/(web|api)/|packages/(domain|contracts|db|importers)/|e2e/)' && echo web
```

If a filter is ever wrong, widen it. The cost of being wrong in that direction
is a few minutes; in the other it is a check nobody notices is gone.

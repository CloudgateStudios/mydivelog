# Deployment & Operations

Lean at launch, container-based so nothing here is a one-way door.

## Providers

| Concern | Provider | Why |
|---|---|---|
| Compute | **Fly.io** | Containers, cheap small instances, easy multi-process apps, global if ever needed |
| Database | **Neon** (managed Postgres) | Branching gives real per-PR preview databases; PITR included; scale-to-zero for non-prod |
| Object storage | **Cloudflare R2** | S3-compatible, **zero egress fees** — decisive once photos and profile downloads exist |
| DNS / CDN / WAF | **Cloudflare** | Free tier covers everything needed at launch |
| Email | **Resend** | Transactional only |
| Payments | **Stripe** | Checkout + Customer Portal, hosted |
| Errors | **Sentry** | API, web, admin, Flutter in one org |
| Logs / metrics | **Axiom** or Grafana Cloud free tier | OpenTelemetry from the API |
| Uptime | **Better Stack** | External probes + status page |
| Secrets | Fly secrets, sourced from **1Password** | No secrets in the repo, ever |
| CI/CD | **GitHub Actions** | |

Everything above is replaceable. The two with real switching cost are Postgres (data
gravity) and Stripe (billing history) — both chosen as boring, portable, standards-based.

## Domains

| Host | Serves |
|---|---|
| `mydivelog.app` | Web — marketing + authenticated portal |
| `www.mydivelog.app` | 301 → apex |
| `api.mydivelog.app` | API |
| `admin.mydivelog.app` | Admin panel (Cloudflare Access, IP-restricted) |
| `cdn.mydivelog.app` | R2 public bucket for avatars/site photos |
| `status.mydivelog.app` | Better Stack status page |
| `dev.mydivelog.app`, `api-dev.…`, `admin-dev.…` | Dev — single-level names; Universal SSL covers one wildcard level |

Cloudflare proxied, TLS 1.2+, HSTS with preload once stable.

Separate hostnames for web and API keep cookie scope tight and make the admin app trivially
lockable at the edge.

## Environments

| Env | Compute | Database | Deploys | Purpose |
|---|---|---|---|---|
| **local** | docker compose | Postgres + MinIO in Docker | — | Everything runs offline, seeded |
| **preview** | Fly per-PR app | Neon branch from **dev** | Per PR | Every PR gets a real URL and a real database |
| **dev** | Fly, scales to zero | Neon project `mydivelog-dev` | Automatic on push to `main` | Integration testing, demos |
| **prod** | Fly, ≥2 API machines | Neon project `mydivelog-prod`, PITR | Manual, with approval | Real users |

Two deployed environments, not three. A separate staging tier only earns its keep once
there are enough people that a shared dev environment becomes contended; until then it is
another thing to configure, pay for, and forget to keep in sync.

**dev and prod are separate Neon projects, not two branches of one.** Branching is Neon's
best feature and the obvious tool to reach for here, and it is the wrong one for this
boundary: a dev branch cut from prod is a full copy of real divers' logs — sites,
timestamps, notes — in an environment with weaker access control. Separate projects make
that mistake impossible rather than merely discouraged. Branching still earns its place
*inside* the dev project, where per-PR preview databases branch from data that is entirely
synthetic.

**dev scales to zero.** Idle cost is roughly nothing, which is what makes a permanent dev
environment worth having at this stage. Prod never scales to zero — a cold start on a real
request is not acceptable.

Setup is documented step by step in
[the environment setup runbook](./runbooks/environment-setup.md).

**Local must be a single command.** `pnpm dev` brings up Postgres, MinIO, API, worker, web,
admin, migrated and seeded — including the fixture dive data. A contributor who can't run
the import engine locally in ten minutes won't work on it.

## CI/CD

```
PR opened
  ├─ lint · typecheck · format
  ├─ unit tests            (packages/domain — fast, run first, fail fast)
  ├─ integration tests     (API against ephemeral Postgres)
  ├─ golden fixture test   (the real workbook + UDDF merge snapshot)
  ├─ flutter analyze + test
  ├─ build all containers
  └─ deploy preview app + Neon branch → comment the URL on the PR

merge to main
  ├─ full suite
  ├─ deploy dev          (automatic, no gate)
  └─ smoke tests against dev

manual prod deploy  (Actions → Deploy → prod)
  ├─ await required-reviewer approval on the `prod` environment
  ├─ migrate production   (expand/contract, backward-compatible)
  ├─ deploy api, worker, web, admin  (rolling, health-gated, sequential)
  └─ post-deploy smoke tests asserting each service names itself
```

### Migrations

**Expand/contract, always.** Deploys are rolling, so old and new code run simultaneously.

1. *Expand* — add the column/table, nullable, no constraint. Deploy.
2. *Backfill* — a job, batched, resumable, monitored.
3. *Use* — code writes and reads the new shape. Deploy.
4. *Contract* — add constraints, drop the old column. A **separate later release.**

A migration that would lock `dives` is rejected in review. Index creation is `CONCURRENTLY`.
Every migration is tested against a dev database restored from a production snapshot
before it reaches production.

### Flutter releases
Separate cadence from the server. Fastlane → TestFlight / Play internal track. Desktop:
signed and notarized macOS build, MSIX for Windows, distributed from the site.

**The API must support the oldest app version still in the wild.** Mobile users do not
update on your schedule. Version-skew tests run the current API against the previous two
client contract versions, and a minimum-supported-version endpoint can force an upgrade when
genuinely required.

## Backups & Recovery

Dive logs are irreplaceable. A diver's 200 dives cannot be regenerated from anywhere. This
section is a product feature, not an ops chore.

| Layer | Mechanism | Retention |
|---|---|---|
| Postgres PITR | Neon continuous | 7 days (30 on paid tier) |
| Logical dump | Nightly `pg_dump` → R2, encrypted | 30 daily, 12 monthly |
| Off-provider copy | Weekly sync to a second provider's bucket | 12 weeks |
| Object storage | R2 versioning + lifecycle | 90 days on delete |
| User-level | Self-serve full export, any time, free | — |

**Targets:** RPO ≤ 5 minutes, RTO ≤ 4 hours.

**Restore drills, quarterly and documented.** Restore the previous night's dump into a
scratch environment, run the fixture verification, record the wall-clock time in
`docs/runbooks/restore-drill-log.md`. An untested backup is not a backup, and a company
whose product is "we keep your history safe" must be able to prove it.

The off-provider copy exists because the failure mode that actually kills companies is
account-level loss at a single provider, not disk failure.

## Observability

**Structured JSON logs** with a request id propagated through API → worker → response
header. Never log dive notes, tokens, or email addresses in full.

**Traces** via OpenTelemetry. The spans that matter: import parse duration by format, match
scoring, commit transaction, profile blob upload.

**Metrics and the alerts that page:**

| Alert | Threshold |
|---|---|
| API 5xx rate | > 1% over 5 min |
| p95 latency | > 1s over 10 min |
| Job queue depth | > 500 or oldest job > 15 min |
| Import failure rate | > 10% over 1 hour |
| DB connection saturation | > 80% |
| Disk / storage growth | anomalous daily delta |
| Failed logins | spike detection |
| **Backup job failure** | any occurrence — pages immediately |
| Cert expiry | < 14 days |

Business metrics on a dashboard, not paging: signups, imports started vs committed
(**activation**), dives per user, revert rate.

**Import-committed-vs-started is the single most important number in the product.** A
falling ratio means the import flow is losing people, and that is the whole business.

## Runbooks

Written before launch, in `docs/runbooks/`:

- Database restore from PITR and from logical dump
- Import stuck in `parsing` — diagnose and requeue
- Queue backed up — scale workers, find the poison job
- Rolling back a bad deploy
- Rotating a leaked secret
- Responding to a suspected data breach (see [Security](./10-security-privacy.md))
- Handling a GDPR deletion or export request
- Suspending an abusive account

## Scaling Steps

| Signal | Action |
|---|---|
| API CPU > 60% sustained | Add machines (stateless — no coordination) |
| Import backlog persistent | Add worker machines; consider per-format concurrency limits |
| DB CPU high on reads | Neon read replica; route stats and admin queries to it |
| DB write contention | Partition `dives` and `change_log` by `user_id` |
| Storage egress cost | Already zero on R2 |
| Global latency complaints | Fly regions for API reads; DB stays primary-region until it hurts |

None of these require an architecture change, which is the point of the choices in
[Architecture](./03-architecture.md).

## Launch Checklist

- [ ] Domains, TLS, HSTS, redirects verified
- [ ] dev mirrors prod configuration exactly, apart from machine counts and scale-to-zero
- [ ] Migrations verified against a production-shaped restore
- [ ] **Backup restore drill completed and timed**
- [ ] Alerts firing to a real destination, tested by deliberately breaking something
- [ ] Sentry receiving from api, worker, web, admin, flutter
- [ ] Rate limits verified under load
- [ ] Stripe webhooks verified in live mode; a real test purchase and refund completed
- [ ] Privacy policy, ToS, cookie notice published
- [ ] GDPR export and deletion paths working end to end
- [ ] Status page live
- [ ] Support inbox monitored
- [ ] Load test: 100 concurrent imports of a 200-dive file
- [ ] `docs/runbooks/` complete
- [ ] Rollback rehearsed at least once

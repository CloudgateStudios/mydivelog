# Runbook: Creating the dev and prod environments

One-time setup for Fly.io, Neon, Cloudflare R2, and GitHub. Roughly 45–60
minutes. Everything the repository needs to deploy already exists — this
creates the accounts and resources those files point at.

Work through it top to bottom; later steps depend on values produced earlier.

## What you are creating

Two deployed environments. `local` stays as it is (`pnpm dev`).

| | dev | prod |
|---|---|---|
| Purpose | Integration testing, demos, the place things break | Real users |
| Deploys | Automatic, on every push to `main` | Manual, with approval |
| Data | Synthetic and fixture only — **never a copy of production** | Real |
| Cost when idle | ≈ $0 (scales to zero) | Always on |

### Naming

Fixed conventions the config files already assume. Deviating means editing
`infra/fly/*.toml` and `.github/workflows/deploy.yml`.

| Resource | dev | prod |
|---|---|---|
| Fly app — api | `mydivelog-api-dev` | `mydivelog-api-prod` |
| Fly app — worker | `mydivelog-worker-dev` | `mydivelog-worker-prod` |
| Fly app — web | `mydivelog-web-dev` | `mydivelog-web-prod` |
| Fly app — admin | `mydivelog-admin-dev` | `mydivelog-admin-prod` |
| Neon project | `mydivelog-dev` | `mydivelog-prod` |
| R2 buckets | `mydivelog-{uploads,profiles,exports}-dev` | `…-prod` |
| Web | `dev.mydivelog.app` | `mydivelog.app` |
| API | `api.dev.mydivelog.app` | `api.mydivelog.app` |
| Admin | `admin.dev.mydivelog.app` | `admin.mydivelog.app` |

---

## Step 1 — Fly.io

```bash
brew install flyctl   # or: curl -L https://fly.io/install.sh | sh
fly auth login
fly orgs list         # note the org slug you want to use
```

Create all eight apps. They start empty; nothing deploys yet.

```bash
ORG=<your-org-slug>

for env in dev prod; do
  for svc in api worker web admin; do
    fly apps create "mydivelog-${svc}-${env}" --org "$ORG"
  done
done
```

These apps have no public IP addresses yet. `fly launch` would have assigned
them; `fly apps create` does not. Step 6b allocates them, which is early enough
— nothing is reachable until the first deploy anyway.

**Region.** The configs use `ord` (Chicago). To use something else, run
`fly platform regions` and change `primary_region` in all eight
`infra/fly/*.toml` files. Pick the region closest to your users, and put the
database in the same one — cross-region database latency will dominate every
request.

---

## Step 2 — Neon

Create **two separate projects**, not two branches of one project.

Branching is Neon's best feature and the obvious thing to reach for here. Do
not use it for this boundary. A dev branch created from prod is a full copy of
real users' dive logs — sites, timestamps, notes — in an environment with
weaker access control, which is exactly what
[the privacy posture](../10-security-privacy.md#threat-model) forbids. Separate
projects make that mistake impossible rather than merely discouraged.

Branching still earns its place *inside* each project: per-PR preview databases
branch from `mydivelog-dev`, which holds no real data.

1. Sign in at https://console.neon.tech
2. Create project `mydivelog-prod`
   - Postgres 16 or later, region matching your Fly `primary_region`
   - Enable point-in-time restore
   - **Disable scale-to-zero** — a cold start on a user request is unacceptable
3. Create project `mydivelog-dev`
   - Same version and region
   - **Enable scale-to-zero** (5-minute idle) — this is what makes dev nearly free
4. From each project's dashboard, copy the **pooled** connection string

Use the pooled (PgBouncer) string for the application. Fly machines scale
horizontally and will exhaust direct connections. Keep the direct string too —
Prisma Migrate needs it, and it becomes `DIRECT_DATABASE_URL` in Phase 1.

> Neon's Free plan allows many projects but caps storage per project. Launch is
> usage-based. Two projects on one account bill as combined usage, and dev
> scaling to zero means it contributes almost nothing. Confirm current limits at
> signup — pricing has moved more than once.

---

## Step 3 — Cloudflare R2

1. Cloudflare dashboard → R2 → create six buckets:
   `mydivelog-uploads-dev`, `mydivelog-profiles-dev`, `mydivelog-exports-dev`,
   and the same three with `-prod`
2. Create **two** API tokens, one per environment, each scoped as
   *Object Read & Write* limited to that environment's three buckets
3. Record for each: Access Key ID, Secret Access Key, and the account endpoint
   `https://<account-id>.r2.cloudflarestorage.com`

Separate tokens per environment mean a leaked dev key cannot touch production
uploads.

Keep all buckets **private**. Downloads are served through short-lived signed
URLs; a public bucket would make every diver's uploads world-readable.

---

## Step 4 — Fly secrets

Secrets are per app, so each needs its own. Setting them before the first deploy
avoids a failed boot.

```bash
# --- dev ---
NEON_DEV="postgresql://...pooler...neon.tech/mydivelog?sslmode=require"
R2_DEV_KEY=...
R2_DEV_SECRET=...
R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"

for svc in api worker; do
  fly secrets set --app "mydivelog-${svc}-dev" \
    DATABASE_URL="$NEON_DEV" \
    S3_ENDPOINT="$R2_ENDPOINT" \
    S3_ACCESS_KEY_ID="$R2_DEV_KEY" \
    S3_SECRET_ACCESS_KEY="$R2_DEV_SECRET" \
    S3_BUCKET_UPLOADS="mydivelog-uploads-dev" \
    S3_BUCKET_PROFILES="mydivelog-profiles-dev" \
    S3_BUCKET_EXPORTS="mydivelog-exports-dev"
done

for svc in web admin; do
  fly secrets set --app "mydivelog-${svc}-dev" \
    API_URL="https://api.dev.mydivelog.app"
done
```

Repeat for prod with the prod values and `API_URL=https://api.mydivelog.app`.

Nothing above is used by the code yet — Phase 0 has no database or storage
client. Setting them now means Phase 1 deploys without a second pass through
this runbook.

Verify with `fly secrets list --app mydivelog-api-dev` (names and digests only;
values are never readable again — keep them in 1Password).

---

## Step 5 — GitHub Environments and deploy tokens

Create one deploy token per app. Fly deploy tokens are scoped to a single app,
which is the point: a leaked token deploys one service in one environment.

```bash
for env in dev prod; do
  for svc in api worker web admin; do
    echo "=== ${svc}-${env} ==="
    fly tokens create deploy --app "mydivelog-${svc}-${env}" -x 8760h
  done
done
```

Copy each token **whole**, including the leading `FlyV1 ` and its space.

Then in GitHub → Settings → Environments, create `dev` and `prod`.

In **each** environment add four secrets, using identical names in both:

| Secret | Value |
|---|---|
| `FLY_TOKEN_api` | that environment's api token |
| `FLY_TOKEN_worker` | that environment's worker token |
| `FLY_TOKEN_web` | that environment's web token |
| `FLY_TOKEN_admin` | that environment's admin token |

Names match in both environments on purpose — the workflow references
`FLY_TOKEN_api` and GitHub resolves it to whichever environment the job
declares. No branching logic in the workflow.

On the **`prod` environment only**, configure protection:

- **Required reviewers** — yourself is enough for now. This is the gate that
  makes production deploys deliberate.
- **Deployment branches** — restrict to `main`.

Nothing else is needed. `dev` stays unprotected so pushes deploy automatically.

---

## Step 6 — DNS and certificates

### 6a. Point the domain at Cloudflare first

The rest of this step assumes `mydivelog.app` resolves through Cloudflare. If
the domain is registered elsewhere (Hover, Namecheap, Google Domains), you do
**not** need to transfer the registration — only delegate DNS.

> **Registration and DNS are separate things.** The domain stays registered
> where it is, renews there, and is billed there. All that changes is which
> nameservers answer for it.

1. Cloudflare dashboard → Add a site → `mydivelog.app` → **Free** plan
2. Cloudflare scans existing records; check them against your registrar's zone
   and add anything it missed (especially MX and TXT records — losing those
   breaks email)
3. **Delete the registrar's leftover A/AAAA records at the apex and `www`.**
   The scan copies whatever was there, which for a domain that was only parked
   is the registrar's placeholder page. Step 6d replaces them with CNAMEs, and
   DNS forbids a CNAME coexisting with any other record of the same name, so
   they must go first. Leave MX and TXT alone — those coexist with a CNAME
   perfectly well, and deleting them breaks email and domain verification.
4. Cloudflare shows two nameservers, e.g. `xxx.ns.cloudflare.com`
5. At your registrar, replace the existing nameservers with those two
   - **Hover:** domain → *Overview* → *Edit* next to Nameservers
6. Wait for Cloudflare to report the zone Active — usually minutes, allow a few
   hours
7. Set SSL/TLS mode to **Full (strict)**. Anything less either breaks or leaves
   the Cloudflare-to-Fly hop unverified.

**Can you skip this and run DNS from the registrar?** Technically yes — Fly
issues certificates from any DNS provider, and plain A/AAAA records at the apex
work fine. You would lose three things:

| Lost without Cloudflare | Why it matters |
|---|---|
| **Cloudflare Access on admin** | Access is enforced at Cloudflare's edge and needs the hostname proxied. Without it the admin panel — which reads across every user's account — is on the public internet behind nothing but application auth. |
| **R2 custom domain** (`cdn.mydivelog.app`) | Needs the zone on Cloudflare. Without it, media is served from the account's `r2.cloudflarestorage.com` hostname or through the API. |
| **Apex CNAME flattening** | Most registrars, Hover included, cannot put a CNAME at the apex. You would allocate a Fly IPv4 and pin A/AAAA records, then remember to update them if the address ever changes. Cloudflare flattens a CNAME at the apex, so the apex tracks `…fly.dev` on its own. |

Free DDoS protection, WAF, and CDN caching for the marketing pages come along
with it. The migration takes about fifteen minutes and is reversible by putting
the old nameservers back, so there is little reason not to.

### 6b. Allocate public IP addresses

`fly launch` assigns addresses automatically; `fly apps create` — used in step 1
— does not. Without them `fly certs add` succeeds but warns *"Your app has no
public IP addresses"* and validation never completes.

```bash
for env in dev prod; do
  for svc in api web admin; do
    fly ips allocate-v6 --app "mydivelog-${svc}-${env}"
    fly ips allocate-v4 --shared --app "mydivelog-${svc}-${env}"
  done
done
```

Both are free. **Shared** IPv4 is the right choice: these are HTTP-only apps
behind Cloudflare, and Fly routes shared addresses by SNI. A dedicated IPv4
costs $2/month per app and buys nothing here.

`worker` is deliberately excluded. It has no `[http_service]` and must not be
reachable from the internet — see `infra/fly/worker.*.toml`.

Confirm with `fly ips list --app mydivelog-web-prod`.

### 6c. Request certificates

```bash
fly certs add mydivelog.app           --app mydivelog-web-prod
fly certs add www.mydivelog.app       --app mydivelog-web-prod
fly certs add api.mydivelog.app       --app mydivelog-api-prod
fly certs add admin.mydivelog.app     --app mydivelog-admin-prod

fly certs add dev.mydivelog.app       --app mydivelog-web-dev
fly certs add api.dev.mydivelog.app   --app mydivelog-api-dev
fly certs add admin.dev.mydivelog.app --app mydivelog-admin-dev
```

Each command prints the DNS records it wants.

### 6d. Create the records

In Cloudflare → DNS, add a **CNAME** per hostname pointing at
`<app-name>.fly.dev`, apex included — Cloudflare flattens it automatically:

| Name | Target |
|---|---|
| `@` | `mydivelog-web-prod.fly.dev` |
| `www` | `mydivelog-web-prod.fly.dev` |
| `api` | `mydivelog-api-prod.fly.dev` |
| `admin` | `mydivelog-admin-prod.fly.dev` |
| `dev` | `mydivelog-web-dev.fly.dev` |
| `api.dev` | `mydivelog-api-dev.fly.dev` |
| `admin.dev` | `mydivelog-admin-dev.fly.dev` |

Fly may also ask for a `_acme-challenge` CNAME per hostname for validation. Add
those exactly as printed; they can be removed once the certificate is issued.

**Set every record to DNS only (grey cloud) until the certificate issues.** The
Cloudflare proxy answers the ACME challenge instead of Fly, and the certificate
sits in "awaiting configuration" indefinitely — the single most common way this
step stalls. Cloudflare defaults new CNAMEs to Proxied, so this is an active
change on each record, not something to skip past.

If Cloudflare refuses a record with *"An A, AAAA, or CNAME record with that host
already exists"*, a leftover record from the old registrar is still there.
Delete that one first — see 6a step 3.

Confirm issuance with `fly certs check <hostname> --app <app>`, then switch each
record to Proxied (orange cloud).

### 6e. Lock down admin

Both admin hostnames go behind Cloudflare Access with an email allowlist —
Zero Trust → Access → Applications → Self-hosted, covering
`admin.mydivelog.app` and `admin.dev.mydivelog.app`.

The admin app reads across all users by design. It should never be reachable
from the open internet, and application-level auth alone is a thinner defense
than an identity check at the edge.

---

## Step 7 — First deploy

Deploy dev by hand once, so a failure is easier to read than through Actions:

```bash
fly deploy . --config infra/fly/api.dev.toml \
  --dockerfile apps/api/Dockerfile --app mydivelog-api-dev
```

Then the rest, and confirm:

```bash
curl https://api.dev.mydivelog.app/health
# {"status":"ok","service":"api","version":"0.0.0","uptimeSeconds":3}
```

**Check the `service` field, not just the status code.** During Phase 0 a health
check appeared to pass while actually hitting an unrelated service on a shared
port. Every endpoint names itself so that cannot happen silently.

After that, GitHub Actions takes over:

- **dev** — automatic on every push to `main`
- **prod** — Actions → Deploy → Run workflow → choose `prod`, then approve

The `services` input takes a comma-separated list (`api,worker`) to redeploy
part of the stack.

---

## Verifying the whole thing

- [ ] `fly apps list` shows eight apps
- [ ] `fly secrets list --app mydivelog-api-prod` shows the expected names
- [ ] Both Neon projects exist; dev scales to zero, prod does not
- [ ] Six R2 buckets, all private, two scoped tokens
- [ ] `dev` and `prod` GitHub Environments each hold four `FLY_TOKEN_*` secrets
- [ ] `prod` requires a reviewer and is restricted to `main`
- [ ] All seven certificates issued
- [ ] Both admin hostnames behind Cloudflare Access
- [ ] Pushing to `main` deploys dev automatically
- [ ] A manual prod run waits for approval before doing anything
- [ ] All three public health endpoints return their own service name

---

## Expected cost

| | Idle | Light use |
|---|---|---|
| Fly dev (4 apps, scale to zero) | ~$0 | ~$2 |
| Fly prod (5 machines) | ~$25 | ~$30 |
| Neon dev (scales to zero) | ~$0 | ~$1 |
| Neon prod | ~$5 | ~$19 |
| R2 | ~$0 | ~$1 |
| **Total** | **~$30** | **~$53** |

Consistent with [the cost model](../12-cost-model.md). Dev costing near nothing
when nobody is using it is the entire reason for scale-to-zero there.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Certificate stuck "awaiting configuration" | Cloudflare proxy is on. Set DNS-only until issued. |
| `fly certs add` warns "no public IP addresses" | Step 6b was skipped. `fly apps create` allocates none. |
| "An A, AAAA, or CNAME record with that host already exists" | The old registrar's record survived the zone scan. Delete it; a CNAME cannot share a name. |
| Cloudflare zone will not go Active | Registrar still lists its own nameservers. Check at the registrar, not in Cloudflare. |
| Email stopped after the nameserver change | MX/TXT records were not carried over. Re-add them in Cloudflare. |
| `Error: app name already taken` | Fly app names are globally unique. Add a suffix and update the toml. |
| Deploy succeeds, machine restart-loops | Missing secret. `fly logs --app <app>`. |
| `FLY_TOKEN_x is not set` | Secret is on the repo rather than the environment, or the name's case is wrong. |
| Health check fails, app looks fine | Fly checks port 8080 internally. Confirm the container listens on `0.0.0.0`, not localhost. |
| Prod deploy starts with no approval | `prod` environment has no required reviewers. |
| Postgres connection exhaustion | Using the direct string instead of the pooled one. |

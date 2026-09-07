# Runbook: locking down the admin panel

The admin panel reads every diver's dive data. It is protected two ways, and
both are needed.

## Why one is not enough

Cloudflare Access protects **a hostname**. Fly also serves every app on
`<app-name>.fly.dev`, which reaches the same container without passing through
Cloudflare at all.

That gap was live:

```
admin-dev.mydivelog.app         → 302  (Access challenge)
mydivelog-admin-dev.fly.dev     → 200  (the panel)
mydivelog-admin-dev.fly.dev/dives → 200
```

Anyone who guessed the Fly app name — which follows an obvious pattern — could
read the whole panel. The application now verifies the Access JWT itself, so
the origin refuses a request that did not come through Cloudflare no matter
which hostname it arrived on.

## What to set

Both values come from the Cloudflare dashboard.

**Team domain** is the host in your Access login URL. If a challenge redirects
to `https://snowy-waterfall-f56e.cloudflareaccess.com/cdn-cgi/access/login/...`
then the team domain is `snowy-waterfall-f56e.cloudflareaccess.com`.

The team domain alone closes the hostname bypass: it pins the signature and
the issuer, so a request that did not come through this Access team is refused.
Set it first and the panel is protected.

```bash
for app in admin api; do
  for env in dev prod; do
    fly secrets set --app "mydivelog-${app}-${env}" \
      CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
  done
done
```

**The API too, not only the panel.** Staff changes go through `/v1/admin`, and
the API verifies the same Access token itself rather than trusting that the
panel did — see [Who may change data](#who-may-change-data). Set on the panel
alone, every staff mutation answers 403.

**Audience (AUD)** narrows it further, to tokens minted for *this* application
rather than any application in the team. It is worth adding, and it is not
what stands between the panel and the internet.

One Access application can cover several hostnames — ours has both
`admin.mydivelog.app` and `admin-dev.mydivelog.app` as destinations — and an
AUD belongs to the **application**, not the hostname. So both Fly apps take the
same value here. If you later split dev and prod into separate Access
applications, they get different ones.

```bash
for app in admin api; do
  for env in dev prod; do
    fly secrets set --app "mydivelog-${app}-${env}" CF_ACCESS_AUD=<the AUD tag>
  done
done
```

Finding it in the dashboard has moved around. If Access → Applications → your
app → **Details** does not show it, ask the API:

```bash
curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps" \
  | jq -r '.result[] | "\(.name)\t\(.aud)"'
```

Until it is set, the app logs a warning at startup saying the audience is not
pinned — a half-configured check looks exactly like a configured one from the
outside, so it says so from the inside.

## Verifying

```bash
# Through Cloudflare: an Access challenge, as before.
curl -s -o /dev/null -w '%{http_code}\n' https://admin-dev.mydivelog.app/

# Direct to the origin: refused by the application itself.
curl -s -o /dev/null -w '%{http_code}\n' https://mydivelog-admin-dev.fly.dev/dives
# 403 — anything else means the check is not configured and is failing open
```

A forged `Cf-Access-Authenticated-User-Email` header changes nothing. That
header is set by Cloudflare and can be set by anything reaching the origin
directly; the signed JWT is what proves something.

## Who may change data

Reading the panel and changing data are separate permissions, and both are
required.

**Cloudflare Access** decides who reaches the panel at all. **`users.is_staff`**
decides whether the API will act on their behalf. A person removed in either
place stops being staff, which is the point: revoking access should not depend
on remembering to do it twice, and neither half should be sufficient alone.

**The two addresses have to match.** The guard looks the account up by the
email in the Access token, so someone whose Access identity is not also their
MyDiveLog account address gets a 403 that looks exactly like a missing flag.

Adding someone is therefore two steps: add them to the Access policy, then set
the column.

### Setting it on dev or prod

Over `fly ssh`, so the database URL never leaves Fly. Nothing to copy, nothing
to paste into a shell that keeps history.

First, see who exists and who is already staff:

```bash
fly ssh console --app mydivelog-api-dev -C 'node --input-type=module -e "const {createPrismaClient} = await import(`/app/node_modules/@mydivelog/db/dist/index.js`); const p = createPrismaClient(); console.table(await p.user.findMany({select:{email:true,isStaff:true}})); process.exit(0);"'
```

Then grant it. `--create` is deliberately absent: against a real environment a
mistyped address should be an error, not a brand new staff account nobody is
looking for.

```bash
fly ssh console --app mydivelog-api-dev \
  -C 'node node_modules/@mydivelog/db/prisma/staff.ts them@example.com'
```

Swap `-dev` for `-prod` to do the same there. They are separate databases, so
staff on one is not staff on the other — which is the right default.

Removing someone is one step, in Access. `--revoke` clears the column as well,
which is tidy rather than load-bearing.

If `fly ssh` is not an option, the Neon console's SQL editor reaches the same
database:

```sql
UPDATE users SET is_staff = true WHERE email = 'them@example.com';
-- UPDATE 0 means the address is wrong, not that it worked
```

Every change they then make writes an `audit_events` row **in the same
transaction as the change**, which is what makes "every staff action appears in
the audit log" a property of the code rather than a habit. It is visible at
`/audit` in the panel, and nothing in the panel can edit or delete a row there.

## What is deliberately still open

`/api/health` is excluded from the check. Fly's own health check calls it from
inside the network with no Access token and no way to obtain one — covered, it
marks every machine unhealthy and the deploy rolls back.

The response is a status, a service name, a version and an uptime. No data and
nothing identifying. Cloudflare still challenges it on the public hostname.

## Local development

There is no Access locally, so the check is disabled explicitly:

```
ADMIN_ACCESS_CHECK_DISABLED=true
```

It fails **closed** by default. An unconfigured check is indistinguishable from
a missing one, and the cost of guessing wrong is publishing every diver's
logbook — so the safe state is the default and the opt-out has to be typed on
purpose. Only the exact string `true` disables it.

With no Access token there is also no identity to attribute changes to, so one
is named explicitly:

```
ADMIN_ACCESS_CHECK_DISABLED=true
ADMIN_DEV_STAFF_EMAIL=staff@mydivelog.local
```

```bash
pnpm staff staff@mydivelog.local --create
```

`--create` makes the account as well as setting the flag. Locally that is what
you want; the alternative is "sign in through the web app first", which is
three steps to make the panel work on a fresh clone.

Named in the environment rather than read from a header on purpose. A
development bypass that takes an identity from the request is a production
authentication bypass waiting for one misconfiguration — with this shape, an
attacker who somehow set `ADMIN_ACCESS_CHECK_DISABLED` still cannot choose who
they are.

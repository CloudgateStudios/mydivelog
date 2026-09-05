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
for env in dev prod; do
  fly secrets set --app "mydivelog-admin-${env}" \
    CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
done
```

**Audience (AUD)** narrows it further, to tokens minted for *this* application
rather than any application in the team. It is worth adding, and it is not
what stands between the panel and the internet.

One Access application can cover several hostnames — ours has both
`admin.mydivelog.app` and `admin-dev.mydivelog.app` as destinations — and an
AUD belongs to the **application**, not the hostname. So both Fly apps take the
same value here. If you later split dev and prod into separate Access
applications, they get different ones.

```bash
for env in dev prod; do
  fly secrets set --app "mydivelog-admin-${env}" CF_ACCESS_AUD=<the AUD tag>
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

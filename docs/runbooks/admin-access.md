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

**Audience (AUD)** is per application: Access → Applications → your admin app →
Overview → *Application Audience (AUD) Tag*. Without it, a token minted for any
other application in the same Access team is accepted here — so it is worth the
extra minute.

```bash
for env in dev prod; do
  fly secrets set --app "mydivelog-admin-${env}" \
    CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com \
    CF_ACCESS_AUD=<the app's AUD tag>
done
```

> The AUD tag differs per application, so `dev` and `prod` take different
> values. Setting one on both is worse than setting neither, because it looks
> configured.

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

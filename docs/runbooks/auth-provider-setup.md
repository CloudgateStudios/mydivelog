# Runbook: Google sign-in and transactional email

Phase 2 ships with a stub login so the API is usable before either of these
exists. This connects the real ones. Roughly 30 minutes.

Apple sign-in is deliberately not here: it costs $99/year and is only required
once the iOS app offers third-party login, which is Phase 7.

## What has to be true first

`AUTH_ACCESS_SECRET` must be set on every deployed API app. The API refuses to
start without it rather than sign sessions with a default, so this is a
prerequisite for the apps booting at all, not just for sign-in.

```bash
for env in dev prod; do
  fly secrets set --app "mydivelog-api-${env}" \
    AUTH_ACCESS_SECRET="$(openssl rand -base64 48)"
done
```

Use a **different** value per environment. A shared secret means a dev token is
valid in production.

`DIRECT_DATABASE_URL` must also be set on both API apps. Every deploy runs
`prisma migrate deploy` as a Fly release command, and Prisma Migrate takes an
advisory lock and runs DDL — neither survives Neon's connection pooler. Use the
**direct** (non-pooled) Neon string here; `DATABASE_URL` stays pooled for the
application itself.

```bash
fly secrets set --app mydivelog-api-dev  DIRECT_DATABASE_URL="postgresql://...neon.tech/mydivelog?sslmode=require"
fly secrets set --app mydivelog-api-prod DIRECT_DATABASE_URL="postgresql://...neon.tech/mydivelog?sslmode=require"
```

If it is missing, migrations fall back to the pooled URL and the release command
is likely to fail — which aborts the deploy rather than starting new code
against an old schema. That is the intended failure, but it is a slow way to
discover a missing secret.

---

## Step 1 — Google OAuth client

1. https://console.cloud.google.com → create a project, `MyDiveLog`
2. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name `MyDiveLog`, your support email, `mydivelog.app` as the
     authorized domain
   - Scopes: `openid`, `email`, `profile` — nothing more. Anything beyond these
     triggers Google's verification review and delays launch for weeks.
   - While the app is in *Testing*, only listed test users can sign in. Add
     yourself now and publish before launch.
3. **Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - Authorized redirect URIs — both, exactly:
     ```
     https://api.mydivelog.app/v1/auth/oauth/google/callback
     https://api-dev.mydivelog.app/v1/auth/oauth/google/callback
     ```
   - For local work, add `http://localhost:53001/v1/auth/oauth/google/callback`
4. Copy the client ID and client secret

Set them per environment:

```bash
fly secrets set --app mydivelog-api-dev \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  GOOGLE_REDIRECT_URI=https://api-dev.mydivelog.app/v1/auth/oauth/google/callback

fly secrets set --app mydivelog-api-prod \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  GOOGLE_REDIRECT_URI=https://api.mydivelog.app/v1/auth/oauth/google/callback
```

> **One OAuth client or two?** One client with both redirect URIs is simpler and
> fine at this stage. Two clients means a leaked dev secret cannot mint
> production sessions, which is worth doing before real users exist. Either
> works with the configuration above.

Until these are set, `/v1/auth/oauth/google/start` answers
`provider_not_configured` rather than failing obscurely.

---

## Step 2 — Resend, for magic links

1. https://resend.com → add domain `mydivelog.app`
2. Add the DNS records it prints to Cloudflare — SPF, DKIM, and the return-path
   CNAME. **Set these to DNS only (grey cloud);** proxying mail records breaks
   delivery.
3. Wait for the domain to verify
4. Create an API key scoped to **sending only**

```bash
for env in dev prod; do
  fly secrets set --app "mydivelog-api-${env}" \
    RESEND_API_KEY=... \
    MAIL_FROM="MyDiveLog <no-reply@mydivelog.app>"
done
```

`MAIL_FROM` must be an address on the verified domain. Resend rejects anything
else, and the rejection is only visible in the API log — `/v1/auth/email/request`
answers 204 whatever happens, because a response that varied would tell an
attacker which addresses have accounts.

Both values are required. With only one set the API logs a warning at startup of
the first request and delivers nothing.

Locally, `AUTH_DEV_LOGIN_ENABLED=true` writes the link to the API log instead of
sending it, so the flow is exercisable without a mail provider at all.

Send yourself one before trusting it. A domain that verifies still lands in spam
if DMARC is missing, and the first person to notice should be you.

---

## Step 3 — CORS

The browser treats every API call as cross-origin, because the web app and the
API are on different hostnames.

```bash
fly secrets set --app mydivelog-api-dev  CORS_ORIGINS=https://dev.mydivelog.app
fly secrets set --app mydivelog-api-prod CORS_ORIGINS=https://mydivelog.app,https://www.mydivelog.app
```

---

## Step 4 — Turn the stub login off

`AUTH_DEV_LOGIN_ENABLED` must be **absent or false** in dev and prod. It is
enabled only in `.env` for local work. With it on, anyone can mint a session for
any address.

```bash
for env in dev prod; do
  fly secrets unset AUTH_DEV_LOGIN_ENABLED --app "mydivelog-api-${env}" 2>/dev/null || true
done
```

Confirm it is off:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://api-dev.mydivelog.app/v1/auth/dev/login \
  -H 'content-type: application/json' -d '{"email":"probe@example.invalid"}'
# 400 — anything else means the stub login is live in a deployed environment
```

---

## Verifying

There is no sign-in UI yet — the web portal is Phase 5 — but both flows are
fully exercisable with curl and a browser address bar. Nothing below needs a
page to exist.

### The stub login is off

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://api-dev.mydivelog.app/v1/auth/dev/login \
  -H 'content-type: application/json' -d '{"email":"probe@example.invalid"}'
# 400 — anything else means the stub login is live in a deployed environment
```

> This is the one auth endpoint that answers before touching the database, so a
> 400 says nothing about whether the schema is current. Check that separately,
> below.

### The schema is current

```bash
curl -s -X POST https://api-dev.mydivelog.app/v1/auth/oauth/google/start \
  -H 'content-type: application/json' -d '{}'
```

A JSON body with `authorizationUrl` means the migration ran. A 500 means it did
not: the release command failed, or was never configured. `fly logs -a
mydivelog-api-dev` names the missing table.

### Google sign-in, end to end

1. Take the `authorizationUrl` from the call above and open it in a browser
2. Approve. Google redirects to the API's GET callback, which forwards you to
   `https://dev.mydivelog.app/auth/callback?code=...&state=...`
3. That page does not exist yet, which is fine — `code` and `state` are in the
   address bar. Copy them:

```bash
curl -s -X POST https://api-dev.mydivelog.app/v1/auth/oauth/google/callback \
  -H 'content-type: application/json' \
  -d '{"code":"PASTE_CODE","state":"PASTE_STATE"}'
```

An `accessToken`, a `refreshToken` and your user object come back. Repeating the
same call must fail — the state is consumed on first use.

### A magic link arrives and works once

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://api-dev.mydivelog.app/v1/auth/email/request \
  -H 'content-type: application/json' -d '{"email":"you@example.com"}'
# 204, always — including for addresses that do not exist
```

The email arrives with a link to `https://dev.mydivelog.app/auth/verify?token=...`.
That page is also Phase 5; take the token from the URL:

```bash
curl -s -X POST https://api-dev.mydivelog.app/v1/auth/email/verify \
  -H 'content-type: application/json' -d '{"token":"PASTE_TOKEN"}'
```

Run it twice. The second attempt must fail with *already been used*.

If no email arrives, the 204 told you nothing by design — check
`fly logs -a mydivelog-api-dev` for `could not deliver a sign-in link`.

### Checklist

- [ ] `AUTH_ACCESS_SECRET` set, and different per environment
- [ ] `DIRECT_DATABASE_URL` set on both API apps
- [ ] Both API apps boot — `curl https://api-dev.mydivelog.app/health`
- [ ] `/v1/auth/oauth/google/start` returns an `authorizationUrl`, not a 500
- [ ] Google sign-in completes end to end on dev
- [ ] Replaying the same `state` fails
- [ ] A magic link arrives by email and signs you in
- [ ] The link is single-use: the second attempt fails
- [ ] `/v1/auth/dev/login` returns 400 on dev and prod
- [ ] The web app can call the API from a browser without CORS errors

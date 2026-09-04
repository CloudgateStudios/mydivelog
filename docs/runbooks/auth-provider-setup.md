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

Until this is set, magic links are written to the API log rather than emailed —
which is what makes the flow exercisable locally without a mail provider at all.

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

- [ ] `AUTH_ACCESS_SECRET` set, and different per environment
- [ ] Both API apps boot — `curl https://api-dev.mydivelog.app/health`
- [ ] Google sign-in completes end to end on dev
- [ ] A magic link arrives by email and signs you in
- [ ] The link is single-use: following it twice fails the second time
- [ ] `/v1/auth/dev/login` returns 400 on dev and prod
- [ ] The web app can call the API from a browser without CORS errors

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` | The URI in Google's console differs from `GOOGLE_REDIRECT_URI`, exactly — scheme, host, path, no trailing slash |
| `provider_not_configured` | One of the three Google secrets is missing; the API needs all three |
| Google sign-in works for you, nobody else | The consent screen is still in Testing. Publish it. |
| Magic links never arrive | Domain unverified, or the DNS records are proxied. Grey-cloud them. |
| `401` right after a successful sign-in | `AUTH_ACCESS_SECRET` differs between the machine that issued the token and the one verifying it |
| Browser blocks API calls | `CORS_ORIGINS` does not list the exact origin, scheme included |

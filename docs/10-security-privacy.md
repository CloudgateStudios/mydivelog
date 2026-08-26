# Security, Privacy & Compliance

## Threat Model

What actually matters here:

| Asset | Risk | Mitigation |
|---|---|---|
| A diver's full history | Irreversible loss | Backups, tombstones, reversible imports, free export |
| Dive locations + timestamps | **Reveals home, travel patterns, and when a house is empty** | Private by default; explicit, granular sharing; geo-fuzzing option |
| Dive notes | Personal, sometimes medical | Encrypted at rest; staff cannot read them; excluded from admin views |
| Account access | Takeover | OIDC only, no passwords, rotating refresh with reuse detection |
| Uploaded files | Malicious payloads | Type/size validation, isolated parsing, no execution |
| Health/medical mentions | Elevated legal sensitivity | Treated as sensitive category; not used for analytics |

The location-privacy point deserves emphasis. A public dive log is a precise record of where
someone was, when, and — by implication — when they were away from home. Shore-dive sites
near a home address reveal roughly where they live. **Everything is private by default and
sharing is always an explicit act.** Optional coordinate fuzzing (round to ~1 km) for shared
dives.

## Authentication

- **No passwords are ever stored.** Google OIDC, Apple OIDC, and email magic link.
- Apple Sign-In offered wherever Google is (App Store requirement, and better privacy).
- Access token: JWT, 15 min, RS256, memory-only on clients.
- Refresh token: opaque, 60 days, **rotating with reuse detection** — a replayed token
  revokes the whole family.
- Web: refresh token in `HttpOnly; Secure; SameSite=Lax` cookie. Mobile: platform secure
  storage.
- Magic links: single-use, 15 min, rate-limited, and the request endpoint returns 204
  regardless of whether the account exists (no account enumeration).
- Staff accounts: separate allowlist, **mandatory 2FA**, IP-restricted at Cloudflare Access.

## Authorization

Ownership is enforced in the repository layer of `packages/db`, not by controllers
remembering. Every user-owned query requires a `userId` parameter; the type system makes
omission a compile error.

Cross-user access returns **404, not 403** — existence is not disclosed.

An integration test asserts this per endpoint: user B's token against user A's resource must
return 404. It runs in CI and blocks merge.

## Data Protection

| | |
|---|---|
| In transit | TLS 1.2+ everywhere, HSTS with preload |
| At rest | Neon and R2 encryption at rest; `notes` and `privateNotes` additionally encrypted at the application layer with a KMS-managed key |
| Backups | Encrypted before leaving the network |
| Secrets | Fly secrets, sourced from 1Password. Never in the repo — enforced by a pre-commit scanner and a CI secret scan. |
| Logs | Never contain tokens, full emails, or note content |
| PII in errors | Sentry scrubbing configured and verified |

Application-layer encryption of notes means a database compromise does not hand over
divers' personal writing, and it is what makes "staff cannot read your notes" a technical
statement rather than a policy promise.

## Upload Security

Import accepts arbitrary user files, which is the largest attack surface in the product.

- Presigned direct-to-R2 upload; API instances never handle the bytes
- Size cap (100 MB free / 500 MB paid), enforced by the presigned policy
- **Content sniffing, not extension trust**
- **XML parsing with external entities and DTDs disabled** — XXE is the direct threat to a
  UDDF importer and it is a one-line configuration mistake away
- Zip-bomb protection: decompression ratio and output size caps for XLSX and any archive
- Parsers run in the worker, resource-limited, with wall-clock timeouts, never in the API
- A parser crash fails one batch and nothing else
- Uploaded originals are private objects, served only via short-lived signed URLs
- Malformed input is a first-class expected case with fixtures, not an exception path

## Privacy & Compliance

**GDPR/CCPA posture** — assume EU users from day one; divers travel.

| Right | Implementation |
|---|---|
| Access / portability | `POST /v1/me/export-all` — complete archive, machine-readable, self-serve, free |
| Erasure | `DELETE /v1/me` → 30-day grace, emailed confirmation, then hard purge including backups' next rotation |
| Rectification | Ordinary editing |
| Restriction | Account suspension retains data without processing |

Additional commitments:

- **Data minimization.** Collect nothing that isn't logbook data. No third-party analytics
  SDKs in the apps; self-hosted, cookieless product analytics only.
- **Purpose limitation.** Dive data is never sold, never used to train models, never shared
  with dive operators or insurers. Stated plainly in the privacy policy.
- **Sub-processors listed publicly** (Neon, Fly, Cloudflare, Stripe, Resend, Sentry) with a
  changelog.
- **Retention:** logs 30 days, audit events 2 years, deleted accounts purged at 30 days.
- **Cookies:** essential only. No consent banner needed, because there is nothing to consent
  to — which is both cheaper and better.
- **Children:** 13+ (16 in the EU) in ToS. Junior divers exist; no targeting of minors.

## Liability

Dive data touches safety, so the boundary is drawn explicitly and early:

- **MyDiveLog is a record-keeping product. It provides no dive planning, no decompression
  calculation, and no safety guidance.** In the ToS and in the UI where relevant.
- Derived values (SAC rate, surface interval, ascent rates) are presented as **historical
  observations**, never as recommendations for a future dive.
- No no-fly timers, no repetitive-dive planning, no gas-limit warnings framed as advice.
- Data may be incomplete or wrong, especially after import; the diver is responsible for
  verifying their own records. Provenance display supports this rather than obscuring it.
- Not a medical product; dive-related medical notes are stored as user content only.

This is deliberate scope control. The moment the product tells a diver what is safe, it
becomes a different product with a different legal and testing burden.

## Billing Security

- Stripe Checkout and Customer Portal — **card details never touch our infrastructure**
- Webhooks signature-verified and idempotent (`stripe_event_id` unique)
- Entitlements derive from subscription state; no client-trusted plan claims
- Failed payment → grace period → downgrade to free tier. **Never delete data on downgrade.**
  Over-limit accounts become read-only-plus-export, never locked out of their own history.

## Application Security Practice

- Dependencies: Dependabot + `pnpm audit` in CI; a blocking severity threshold
- SAST via CodeQL; secret scanning on every push
- CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors denial on web and admin
- CORS: explicit origin allowlist, credentials only for known origins
- All queries parameterized through Prisma; raw SQL requires review
- Rate limiting per [API Design](./06-api-design.md#rate-limits)
- Audit log for all staff actions, append-only
- Pre-launch: an external penetration test or, at minimum, a structured self-review against
  the OWASP ASVS Level 1 checklist

## Incident Response

Documented in `docs/runbooks/security-incident.md`:

1. **Contain** — revoke credentials, disable the affected path
2. **Assess** — what data, how many users, what window
3. **Notify** — GDPR requires supervisory-authority notification within 72 hours of
   awareness; affected users notified when there is risk to them
4. **Remediate**
5. **Post-mortem** — blameless, published for anything user-affecting

A security contact and a `security.txt` are published from day one so researchers have
somewhere to go that isn't social media.

# Architecture Decision Records

One short file per decision that was genuinely contested. Format: Context → Decision →
Consequences → Status.

## Recorded

| # | Decision | Status | Where argued |
|---|---|---|---|
| 001 | Store all measurements in SI units | Accepted | [Data Model](../04-data-model.md#1-store-si-always) |
| 002 | Field-level provenance for every merge-relevant field | Accepted | [Data Model](../04-data-model.md#provenance--the-mechanism-that-makes-merging-safe) |
| 003 | Dive profiles as compressed blobs in object storage, not Postgres | Accepted | [Data Model](../04-data-model.md#profile-storage) |
| 004 | Dive number is a display ordinal, never an identifier | Accepted | [Data Model](../04-data-model.md#2-dive-identity-is-time-not-number) |
| 005 | pg-boss over Redis/BullMQ | Accepted | [Architecture](../03-architecture.md#why-this-shape) |
| 006 | Separate admin application, not a role flag | Accepted | [Architecture](../03-architecture.md#why-this-shape) |
| 007 | Fly.io + Neon over GCP/Terraform | Accepted | [Deployment](../09-deployment.md#providers) |
| 008 | No passwords — OIDC and magic links only | Accepted | [Security](../10-security-privacy.md#authentication) |
| 009 | Export is free and full-fidelity, forever | Accepted | [Cost Model](../12-cost-model.md#revenue) |
| 010 | No dive planning or safety guidance, ever | Accepted | [Security § Liability](../10-security-privacy.md#liability) |

## Pending

| # | Decision | Resolve by |
|---|---|---|
| 011 | Custom sync engine vs PowerSync/ElectricSQL | Phase 0 spike |
| 012 | PostGIS vs `earthdistance` for site clustering | Phase 1 |
| 013 | Hard uniqueness on `(userId, diveNumber)` | After Phase 3 proves import quality |

Write the file when the decision is made, not before. An ADR nobody argued about is noise.

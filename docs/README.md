# MyDiveLog — Implementation Plan

MyDiveLog (https://mydivelog.app) is a digital logbook for scuba divers: one trustworthy,
portable record of every dive you have ever done, reachable from any device, online or not.

Divers already log dives — in spreadsheets, in dive computer apps, in three different
vendor clouds, on paper. **The product is not "another logbook." It is the place all of
those finally converge.** Import, merge, and export are the product; CRUD is table stakes.

This document set is written before any code so the data model and import engine can be
argued about while they are still cheap to change.

## Read In This Order

| # | Document | What it settles |
|---|---|---|
| 1 | [Product Brief](./01-product-brief.md) | Who this is for, what v1 is, what it refuses to be |
| 2 | [Source Data Analysis](./02-source-data-analysis.md) | What the two real sample files prove about dive data |
| 3 | [Architecture](./03-architecture.md) | Services, repo layout, boundaries, technology choices |
| 4 | [Data Model](./04-data-model.md) | Entities, keys, units, provenance, profile storage |
| 5 | [Import & Merge Engine](./05-import-merge-engine.md) | The core differentiator, in detail |
| 6 | [API Design](./06-api-design.md) | REST contract, auth, idempotency, versioning |
| 7 | [Offline Sync](./07-offline-sync.md) | Local-first Flutter apps and conflict resolution |
| 8 | [Client Applications](./08-clients.md) | Web portal, admin panel, Flutter mobile/desktop |
| 9 | [Deployment & Operations](./09-deployment.md) | Environments, CI/CD, backups, monitoring, domains |
| 10 | [Security, Privacy & Compliance](./10-security-privacy.md) | Auth, data protection, billing, liability |
| 11 | [Roadmap](./11-roadmap.md) | Phased build order with acceptance criteria |
| 12 | [Cost Model](./12-cost-model.md) | What this costs to run at launch and at scale |

Architecture Decision Records live in [`docs/decisions/`](./decisions/).

## The Core Bet

> A diver will move their entire history to MyDiveLog only if they believe it will
> outlive the app that created it.

Everything follows from that sentence:

- **Import must be genuinely good**, not a demo-quality CSV upload.
- **Merging beats duplicating.** Two records of one dive must become one dive with two sources.
- **Export must be as good as import.** No lock-in, stated openly, as a feature.
- **Backups must be a promise you can demonstrate**, not an implementation detail.
- **Offline must actually work.** Dives happen on boats, in Bonaire, with no signal.

## Confirmed Decisions

| Decision | Choice |
|---|---|
| Ambition | Public SaaS — free tier plus paid tier |
| Hosting | Managed PaaS (Fly.io) + managed Postgres, container-based for portability |
| Backend | TypeScript everywhere — NestJS API, Next.js web + admin |
| Apps | Flutter, full offline-first with a sync engine |

## Build Order Summary

```
0. Foundations       →  repo, CI, environments, contracts
1. Data model        →  schema + migrations + seed taxonomy
2. API + auth        →  authenticated dive CRUD, OpenAPI
3. Import & merge    →  UDDF + spreadsheet, dogfooded on real data   ◄── the proving phase
4. Admin panel       →  so imports are debuggable by humans
5. Web portal        →  onboarding, import UI, log management, export
6. Launch hardening  →  billing, legal, monitoring, backup drill
7. Flutter (online)  →  apps against the proven contract
8. Offline sync      →  local-first, conflict resolution
9. Social & media    →  buddies, sharing, photos
10. Integrations     →  dive computer BLE, vendor cloud APIs
```

Phase 3 is the phase that decides whether this product is worth building. It is
deliberately placed before any polish.

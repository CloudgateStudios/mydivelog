# MyDiveLog Implementation Plan

MyDiveLog is a digital log book and sharing hub for scuba divers. The service should make it easy to record dives reliably, preserve a complete personal history, work offline during trips, and later support social sharing, imports, analytics, and team operations.

This planning set is intentionally written before implementation so the database and API foundation can be agreed on first.

## Planning Documents

- [Product Brief](./product-brief.md): goals, users, product principles, and MVP scope.
- [Workbook Findings](./workbook-findings.md): what the attached Excel log reveals about real dive data.
- [System Architecture](./system-architecture.md): service boundaries, deployment shape, and major technical decisions.
- [Data Model](./data-model.md): proposed database entities and field-level modeling notes.
- [API Plan](./api-plan.md): API style, resources, sync endpoints, auth, and versioning.
- [Offline Sync Plan](./offline-sync.md): local-first mobile behavior, conflict handling, and sync mechanics.
- [Application Plan](./application-plan.md): web app, Flutter app, admin app, and shared responsibilities.
- [Implementation Roadmap](./implementation-roadmap.md): phases, deliverables, acceptance criteria, and open decisions.
- [Technology Decisions](./technology-decisions.md): stack and provider decisions, options, and rationale.
- [Monthly Cost Model](./monthly-cost-model.md): rough launch cost scenarios for full GCP and hybrid provider options.

## Recommended Build Order

1. Define and migrate the database schema.
2. Build the API layer around authenticated user-owned dive data.
3. Add import tooling for existing logs, starting with the spreadsheet field shape.
4. Build the admin app first so the team can inspect users, imports, and operational health while the product is forming.
5. Build the main website and logged-in web app for onboarding, import/export, and dive log management.
6. Build the Flutter mobile and desktop app once the domain model and API are proven, with offline sync as its core requirement.
7. Add sharing, media, buddy verification, and richer community features once the log book is dependable.

## Core Product Bet

The service wins if divers trust it as the canonical record of their dive history. Everything else, including sharing and community, should build on that trust.

# Product Brief

## Vision

MyDiveLog gives scuba divers one dependable place to record, preserve, analyze, and share their dives. It replaces scattered paper logs, spreadsheet logs, notes apps, dive computer exports, and partial-purpose apps with a consistent digital log book that works wherever divers actually are.

## Primary Users

- Recreational divers who want a clean digital log book.
- Active trip divers who may be offline on boats, islands, or remote resorts.
- Certification-focused divers who need complete and credible dive history.
- Experienced divers who want analytics, search, equipment history, and sharing.
- Dive operators, instructors, and staff users later, if verification and trip workflows become product areas.

## Product Principles

- Offline first for dive capture. A diver should never need signal to log a dive.
- User data belongs to the user. Export and import should be first-class.
- Canonical API and database. Every app should use the same domain model.
- Progressive detail. Quick logging should be fast, but advanced fields should exist.
- Trust before social. Sharing is valuable only if the private log is reliable.

## MVP Scope

The first public release should be usable by real divers, not only staff or private beta testers. It should support:

- Account creation, authentication, and user profile.
- CRUD for dives, locations, sites, gear, gas, and notes.
- Search, sort, filter, and summary statistics.
- Spreadsheet import for existing dive logs.
- Public homepage and product entry point.
- Web app for account access, log review, import/export, and public dive visibility settings.
- Public viewing for dives that a diver explicitly marks as public.
- Separate admin app for support, account lookup, audit trail, and operational health.
- Account deletion, privacy policy, terms, and complete user data export.

The Flutter mobile and desktop app remains a core product goal, but it follows the public web launch so the team can move faster and prove the API first.

## Later Product Areas

- Public or private shared dive pages.
- Buddy tagging and optional buddy confirmation.
- Dive computer imports such as UDDF, DAN DL7, CSV, and vendor exports.
- Photos, videos, marine life sightings, and trip albums. Plan storage and model boundaries early, but do not execute media in the first public release.
- Certification records, documents, and medical reminders.
- Dive planning integrations and operator-specific workflows.
- Public dive site directory with crowd-sourced conditions. Canonical site tables and internal review hooks should exist from day one, but the public directory is later.

## Non-Goals For The Foundation Phase

- Building a polished marketing site before the core log works.
- Tying the data model to one vendor's dive computer format.
- Making social feeds central before privacy, ownership, and sync are stable.
- Hard-coding units, geography, or certification assumptions to one region.
- Buddy signatures or verification in the first public release.

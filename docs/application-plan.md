# Application Plan

## Shared Product Surface

All apps should depend on the same API and domain language. Differences should be about workflow, not data meaning.

Implementation order should be admin first, then the main website, then the Flutter mobile and desktop app. This gives the team operational visibility early, proves the API through browser workflows, and saves the more complex offline sync work for when the underlying contracts are steadier.

Shared concepts:

- Dive.
- Location.
- Dive site.
- Gear.
- Gas mix.
- Dive type tags.
- Media.
- Import and export.
- Sharing and visibility.

## Main Web Application

Primary jobs:

- Introduce the product and convert visitors.
- Sign up, login, account management.
- Import existing logs.
- Review, search, filter, and edit dive logs.
- Manage profile, gear, locations, and sites.
- Export user data.
- Manage public/private visibility for dives.
- Render public dive pages for dives explicitly marked public, without requiring visitors to log in.
- Support account deletion, privacy policy, terms, and complete user data export for public launch.

Recommended early screens:

- Public homepage.
- Auth.
- Dive list.
- Dive detail/edit.
- Summary dashboard.
- Import review.
- Gear manager.
- Location and site manager.
- Account and export settings.
- Legal/privacy pages.
- Public dive page.

Public dive pages should display date, location/site, max depth, duration, water temperature, visibility, gas, dive type tags, and public notes. They should not display gear, weight carried, private notes, exact timestamps, private profile/contact details, or internal metadata.

## Flutter Mobile And Desktop Application

Primary jobs:

- Capture dives in the field, including offline.
- Search and review personal log.
- Manage common fields quickly.
- Sync reliably when network returns.
- Support desktop users who prefer an app over browser workflow.

Recommended early screens:

- Login and initial sync.
- Dive list with offline state.
- Quick add dive.
- Full dive editor.
- Dive detail.
- Gear picker.
- Location and site picker.
- Sync status and conflict resolution.

Mobile-specific considerations:

- Fast entry after a dive with minimal taps.
- Date, time, duration, depth, visibility, and temperature controls optimized for field use.
- Per-field unit selectors for measurements, defaulting to the user's home units but allowing trip-specific metric or imperial entry without changing account settings.
- Defaults from previous dive, trip, location, or gear setup.
- Draft preservation.
- Local notifications only after user opt-in.

Desktop-specific Flutter considerations:

- Wider table/list layouts.
- Keyboard-friendly editing.
- Import review may be better on web, but desktop app can still support core logging.

## Admin Application

Primary jobs:

- Support users without direct database access.
- Inspect operational state.
- Review imports, sync issues, and account health.
- Manage staff roles.
- Audit sensitive access.

Recommended early screens:

- User search.
- User detail.
- Dive count and recent activity.
- Import batch status.
- Sync error overview.
- Audit event log.
- Staff role management.

Admin guardrails:

- Separate application and deployment target, preferably on a separate staff-only subdomain.
- Strict role-based access.
- Audit every user data access.
- Read-only access to user-owned dive data for the first public release.
- No edits to user-owned log data.
- Prefer support notes and user-visible recovery flows.

Keeping admin separate is the safer default because it reduces accidental exposure through the public website, allows stricter network and session policies, and makes admin monitoring cleaner.

## Design And UX Direction

The log book should feel calm, durable, and field-ready. Avoid making it feel like a social network first. Divers should be able to enter data quickly, then add richer details later.

Recommended UX patterns:

- Compact dive list with date, location, site, duration, and max depth.
- Summary stats that feel like a log book dashboard, not vanity metrics.
- Optional advanced sections for gas, gear, conditions, buddies, and media.
- Tag-like controls for dive type.
- Clear privacy controls for every shared item.
- Unit display controls that let users view a dive in home units, source-entered units, or a selected alternate unit system.

## Shared Client SDK

Once the API stabilizes, generate or maintain a shared TypeScript client for web and admin. Flutter can use generated models from OpenAPI or a hand-maintained API package if generation becomes noisy.

## Accessibility And Internationalization

Plan early for:

- Imperial and metric units.
- Time zones and local dive dates.
- Keyboard navigation on web/admin.
- Screen reader labels for forms and tables.
- Localized date and number formatting.
- Future multi-language support.

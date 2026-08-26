# Data Model

Schema sketches below are illustrative Prisma/SQL, not the final migration. The purpose is
to settle *shape and semantics* before code.

## Foundational Rules

### 1. Store SI. Always.

The two sample files disagree on units for every physical quantity. Conversion at the edges
is the only sane approach.

| Quantity | Stored as | Column suffix |
|---|---|---|
| Depth, altitude, visibility | metres | `_m` |
| Temperature | **degrees Celsius** | `_c` |
| Duration, surface interval | seconds | `_s` |
| Weight | kilograms | `_kg` |
| Pressure | bar | `_bar` |
| Volume | litres | `_l` |
| Gas fraction | 0.0–1.0 decimal | `_fraction` |

Note UDDF gives temperature in **kelvin** (`299.74`) and the spreadsheet in **Fahrenheit**
(`79.2`). Both convert to Celsius on the way in. Display units come from
`user_preferences.unit_system` (`metric` | `imperial`) with per-quantity overrides, because
plenty of divers think in feet but Celsius.

Floating point is used for measurements. Money is `numeric`. Never the reverse.

### 2. Dive identity is time, not number.

`dive_number` is a **user-assigned display ordinal**. Real spreadsheets contain `x`,
duplicates, and gaps; inserting a forgotten dive from 2015 renumbers everything after it.

Identity for matching is `(user_id, start_time_utc)` within a tolerance window, corroborated
by depth and duration. See [Import & Merge Engine](./05-import-merge-engine.md#matching).

### 3. Every dive has three time fields.

```
start_time_utc      timestamptz   -- canonical ordering, surface intervals
start_time_local    timestamp     -- what the diver remembers; never recomputed
tz_offset_minutes   integer       -- as recorded, after normalization
tz_name             text?         -- IANA, derived from site geo when available
```

Deriving local time from UTC + a guessed zone loses data. Storing it explicitly means a
broken source offset (see the `-00:04` bug) can be corrected later without destroying the
diver's original record.

### 4. IDs are UUIDv7, generated client-side.

Time-ordered so they index well, and generatable offline so the Flutter app never negotiates
an id with the server. Essential for [offline sync](./07-offline-sync.md).

## Core Entities

### Users & Identity

```prisma
model User {
  id             String   @id @db.Uuid
  email          String   @unique
  emailVerifiedAt DateTime?
  displayName    String?
  status         UserStatus  // active, suspended, deleted
  createdAt      DateTime
  deletedAt      DateTime?   // soft delete; hard purge job after 30 days
}

model Identity {          // one per OIDC provider link
  id           String @id @db.Uuid
  userId       String @db.Uuid
  provider     String        // google | apple | email
  subject      String        // provider's stable user id
  @@unique([provider, subject])
}

model UserPreferences {
  userId          String @id @db.Uuid
  unitSystem      String        // metric | imperial
  depthUnit       String?       // per-quantity overrides
  temperatureUnit String?
  pressureUnit    String?
  weightUnit      String?
  dateFormat      String?
  timezone        String?       // IANA, for display defaults
}

model DiverProfile {
  userId          String @id @db.Uuid
  bio             String?
  homeLocation    String?
  // certifications live in their own table
}

model Certification {
  id           String @id @db.Uuid
  userId       String @db.Uuid
  agency       String        // PADI, SSI, NAUI, GUE, TDI, BSAC, CMAS, RAID, other
  name         String        // "Advanced Open Water"
  level        Int?          // for ordering/progression display
  number       String?
  issuedOn     DateTime?
  instructor   String?
  documentKey  String?       // object storage key for a scanned card
}
```

Passwords are never stored. See [Security](./10-security-privacy.md).

### Dive — the canonical record

```prisma
model Dive {
  id                String   @id @db.Uuid
  userId            String   @db.Uuid
  diveNumber        Int?              // display ordinal, nullable, NOT unique-enforced-hard

  startTimeUtc      DateTime @db.Timestamptz
  startTimeLocal    DateTime
  tzOffsetMinutes   Int
  tzName            String?

  durationS         Int?
  maxDepthM         Float?
  avgDepthM         Float?
  surfaceIntervalS  Int?              // derived from previous dive
  repetitionIndex   Int?              // nth dive of the day

  waterTempMinC     Float?
  waterTempMaxC     Float?
  airTempC          Float?
  visibilityM       Float?
  weightKg          Float?

  waterType         WaterType?        // fresh | salt | brackish
  diveMode          DiveMode?         // opencircuit | ccr | scr | freedive | snorkel
  altitudeM         Float?

  siteId            String?  @db.Uuid
  tripId            String?  @db.Uuid

  rating            Int?              // 1-5
  notes             String?
  privateNotes      String?           // never included in shares/exports by default

  // Derived from profile, denormalized for query/sort/stats
  profileId         String?  @db.Uuid
  hasProfile        Boolean  @default(false)

  createdAt         DateTime
  updatedAt         DateTime
  deletedAt         DateTime?         // tombstone, required for sync
  version           Int      @default(1)

  @@index([userId, startTimeUtc])
  @@index([userId, deletedAt])
  @@index([userId, siteId])
}
```

**On `diveNumber`:** a partial unique index `(userId, diveNumber) WHERE deletedAt IS NULL
AND diveNumber IS NOT NULL` is tempting and should be **avoided at first**. Real imports
contain duplicate and missing numbers; a hard constraint turns a messy import into a failed
import. Instead, detect collisions and offer a transactional renumber operation. Revisit
once import quality is proven.

**On soft deletes:** every user-owned table needs `deletedAt` tombstones because offline
clients must learn about deletions. A purge job hard-deletes after the retention window.

### Sites — shared, geo-clustered

The UDDF gave coordinates with no names; the spreadsheet gave names with no coordinates.
Merging them across all users builds an asset no single diver has.

```prisma
model Site {
  id            String  @id @db.Uuid
  name          String
  regionId      String? @db.Uuid
  latitude      Float?
  longitude     Float?
  geog          Unsupported("geography(Point,4326)")?
  maxDepthM     Float?
  typicalEntry  String?          // shore | boat | dock
  description   String?

  isPublic      Boolean @default(false)  // promoted to the shared database
  ownerUserId   String? @db.Uuid         // set while private
  verifiedAt    DateTime?                // staff-reviewed

  @@index([regionId])
  // GiST index on geog for radius search
}

model SiteAlias {
  id      String @id @db.Uuid
  siteId  String @db.Uuid
  name    String            // "1,000 Steps", "Thousand Steps", "1000 Steps"
  source  String            // import | user | staff
}

model Region {              // hierarchical: Caribbean > Bonaire > Kralendijk
  id        String  @id @db.Uuid
  parentId  String? @db.Uuid
  name      String
  kind      String          // country | state | area
  countryCode String?
}
```

Sites imported from a user's file start **private**. A staff/automated promotion path moves
well-attested sites into the public database. This avoids polluting a shared namespace with
`site_69ab7a96dce6e40c7d3abe65`.

Deduplication is **geographic clustering within ~200 m plus name similarity** — never exact
match. The sample data has sites 200 m apart that are the same site logged twice.

### Trips

Dives cluster naturally: 16 dives in Bonaire over four days in March 2026. Trips are how
divers actually think about their history, and they make the UI far better.

```prisma
model Trip {
  id          String @id @db.Uuid
  userId      String @db.Uuid
  name        String            // "Bonaire 2026"
  startDate   DateTime?
  endDate     DateTime?
  regionId    String? @db.Uuid
  operator    String?           // dive shop / liveaboard
  notes       String?
}
```

Trips can be **auto-proposed on import** by clustering dives on date proximity + shared
region. Proposed, then confirmed — never silently created.

### Tags — the `Dive Type` problem

The spreadsheet's `Dive Type` is a comma-joined multi-value string: 16 combinations built
from 8 base values, including the typo `Dift`. This is a tag set.

```prisma
model Tag {
  id        String  @id @db.Uuid
  slug      String                  // shore, boat, drift, night, wreck, wall, sunset, ...
  label     String
  category  String                  // entry | condition | environment | activity
  isSystem  Boolean                 // seeded taxonomy vs user-created
  userId    String? @db.Uuid        // null for system tags
  @@unique([userId, slug])
}

model DiveTag {
  diveId String @db.Uuid
  tagId  String @db.Uuid
  @@id([diveId, tagId])
}
```

Seeded taxonomy covers the common vocabulary; import fuzzy-matches against it (`Dift` →
`drift`, proposed with the original preserved) and falls back to creating a user tag.

### Gas & Tanks

```prisma
model GasMix {
  id          String @id @db.Uuid
  userId      String? @db.Uuid    // null = system standard (air, EAN32, ...)
  name        String
  o2Fraction  Float               // 0.21 for air
  heFraction  Float  @default(0)  // trimix
  // n2 is derived: 1 - o2 - he. Never stored.
}

model DiveTank {
  id              String @id @db.Uuid
  diveId          String @db.Uuid
  gasMixId        String @db.Uuid
  sequence        Int                 // multi-tank / stage bottles
  volumeL         Float?
  workingPressureBar Float?
  startPressureBar   Float?
  endPressureBar     Float?
  material        String?             // aluminium | steel
  // SAC/RMV derived at read time, never stored
}
```

`n2` is derived, not stored — the UDDF sample has `o2 0.33 / n2 0.66999996`, which is
floating-point noise, not information. Storing it invites contradiction.

Note the spreadsheet models gas as `Gas` + `EAN %` (two columns); UDDF as an o2 fraction.
Both normalize into `GasMix`. Neither file has tank pressures, but most dive computers
export them, so the columns exist from day one.

### Gear

`"Full Wet Suit (5mil Rental), Boots (5mil Rental)"` — a joined string encoding item,
thickness, and rental status.

```prisma
model GearItem {
  id           String @id @db.Uuid
  userId       String @db.Uuid
  kind         String            // wetsuit | drysuit | bcd | regulator | computer | fins | ...
  name         String
  brand        String?
  model        String?
  thicknessMm  Float?
  isRental     Boolean @default(false)
  serialNumber String?
  purchasedOn  DateTime?
  retiredAt    DateTime?
  serviceDueOn DateTime?         // regulators need annual service — a genuinely useful feature
}

model DiveGear {
  diveId     String @db.Uuid
  gearItemId String @db.Uuid
  @@id([diveId, gearItemId])
}

model GearSet {                  // "Warm water kit" — apply in one click
  id     String @id @db.Uuid
  userId String @db.Uuid
  name   String
}
```

Import parses the joined string into structured items where it can, and **always preserves
the raw string** on the source record so nothing is lost to a parsing miss.

### Buddies

```prisma
model Buddy {
  id           String  @id @db.Uuid
  ownerUserId  String  @db.Uuid
  displayName  String
  linkedUserId String? @db.Uuid   // set if they're also a MyDiveLog user
  email        String?
  role         String?            // buddy | instructor | divemaster | guide
}

model DiveBuddy {
  diveId  String @db.Uuid
  buddyId String @db.Uuid
  @@id([diveId, buddyId])
}
```

Buddies start as **text owned by the logging diver**. Linking to a real account is a later
feature and must be consensual in both directions. Never auto-link on email match.

## Provenance — the mechanism that makes merging safe

This is the part that cannot be retrofitted.

```prisma
model DiveSource {
  id             String @id @db.Uuid
  diveId         String @db.Uuid
  importBatchId  String? @db.Uuid
  sourceKind     String       // uddf | subsurface | spreadsheet | manual | api:garmin | ...
  sourceRef      String?      // external id: "dive_69ab7a96dce6e40c7d3abe65"
  sourceFileKey  String?      // object storage key of the original upload
  rawPayload     Json?        // the source's own representation of this dive
  recordedAt     DateTime     // when the source captured it
  createdAt      DateTime
  @@index([diveId])
  @@unique([importBatchId, sourceRef])   // idempotent re-import
}

model DiveFieldProvenance {
  diveId       String @db.Uuid
  fieldPath    String        // "maxDepthM", "site.name", "tanks[0].gasMixId"
  sourceId     String @db.Uuid
  value        Json          // the value this source asserted
  isSelected   Boolean       // is this the value currently live on the dive?
  confidence   Float
  @@id([diveId, fieldPath, sourceId])
}
```

What this buys:

- **"Where did this come from?"** answered for every field in the UI.
- **Non-destructive merge.** The spreadsheet's `46 ft` and the computer's `14.099 m` both
  persist; one is selected, the other is one click away.
- **Reversible imports.** Deleting an import batch removes its sources and re-selects the
  next-best value per field, rather than leaving a corrupted record.
- **Improving precedence rules later** without re-importing anything.

The cost is real: writes are heavier and the merge logic is genuinely more complex. It is
worth it, and it is the single thing that is prohibitively expensive to add after launch.

Store provenance for **merge-relevant scalar fields only** — not for every column. Notes,
depth, duration, temps, gas, site, weight, rating. Not `createdAt`.

## Profile Storage

20,014 waypoints for 96 dives. One row per sample does not scale (see
[Source Data § Finding 5](./02-source-data-analysis.md#finding-5--profile-data-dominates-storage)).

Profiles are written once, read whole, and never queried per-sample. So:

```prisma
model DiveProfile {
  id            String @id @db.Uuid
  diveId        String @db.Uuid @unique
  storageKey    String            // R2 object key
  format        String            // "mdl-profile-v1" (zstd-compressed columnar)
  sampleCount   Int
  intervalS     Float?            // nominal sample interval
  byteSize      Int
  checksum      String

  // Derived summary — lives in Postgres because this is what queries need
  maxDepthM        Float
  avgDepthM        Float
  durationS        Int
  minTempC         Float?
  maxTempC         Float?
  maxAscentRateMPerMin Float?
  hasDecoStops     Boolean @default(false)
  channels         String[]      // ["depth","temp","pressure","ndl","cns"]
}
```

The blob format is columnar (separate arrays per channel) and zstd-compressed. Depth series
delta-compress extremely well; expect **~50–200× reduction** versus the source XML. The
sample file's 4.6 MB becomes tens of kilobytes.

Postgres holds only the summary — a few hundred bytes per dive. A 500-dive diver costs well
under 1 MB in the relational store.

**Why not TimescaleDB?** It solves querying across time series. Nothing here queries across
samples; the chart loads one dive's profile and renders it. Adding a Postgres extension and
its operational burden to avoid an object-storage read is the wrong trade.

**Why not JSONB in Postgres?** It works and it's simpler. But it puts the fastest-growing
data in the most expensive, hardest-to-scale store, and moving it later means a migration
over every dive in the system. Object storage from day one costs one afternoon now.

## Import Bookkeeping

```prisma
model ImportBatch {
  id             String @id @db.Uuid
  userId         String @db.Uuid
  sourceKind     String
  originalFileKey String
  originalFileName String
  fileSize       Int
  checksum       String            // dedupe identical re-uploads
  status         String            // uploaded | parsing | review | committing | committed | failed | reverted
  detectedFormat String?
  mappingProfileId String? @db.Uuid  // saved column mapping for CSV/XLSX
  stats          Json              // {parsed, matched, new, conflicts, skipped, normalized}
  error          String?
  createdAt      DateTime
  committedAt    DateTime?
  revertedAt     DateTime?
}

model ImportRow {
  id            String @id @db.Uuid
  batchId       String @db.Uuid
  rowIndex      Int
  raw           Json              // exactly as parsed
  observation   Json              // normalized DiveObservation
  normalizations Json             // [{field, from, to, reason}] — the -00:04 fix lands here
  issues        Json              // [{severity, code, message, field}]
  matchDiveId   String? @db.Uuid
  matchScore    Float?
  matchReasons  Json
  decision      String            // pending | create | merge | skip
  decidedBy     String?           // auto | user
  resultDiveId  String? @db.Uuid
  @@index([batchId, decision])
}

model MappingProfile {           // reusable CSV/XLSX column mappings
  id       String @id @db.Uuid
  userId   String? @db.Uuid      // null = shared/system template
  name     String                // "My spreadsheet", "Diviac export"
  mapping  Json                  // column → field path + transforms
  isPublic Boolean @default(false)
}
```

`MappingProfile` is a quiet force multiplier. The long tail of "my weird spreadsheet" is
infinite; a good column mapper with shareable templates covers it without writing one
importer per diver.

## Sync & Audit

```prisma
model ChangeLog {                // drives offline sync
  seq        BigInt @id @default(autoincrement())
  userId     String @db.Uuid
  entityType String
  entityId   String @db.Uuid
  operation  String              // upsert | delete
  version    Int
  changedAt  DateTime
  deviceId   String?             // suppress echo to the originating device
  @@index([userId, seq])
}

model AuditEvent {               // staff/security trail, distinct from ChangeLog
  id         String @id @db.Uuid
  actorId    String? @db.Uuid
  actorKind  String              // user | staff | system
  action     String
  entityType String
  entityId   String?
  metadata   Json
  ip         String?
  createdAt  DateTime
}
```

`ChangeLog` is a **sync mechanism**; `AuditEvent` is an **accountability record**. They look
similar and must not be merged — one is high-volume and prunable, the other is retained and
never edited.

## Billing

```prisma
model Subscription {
  id                   String @id @db.Uuid
  userId               String @db.Uuid @unique
  stripeCustomerId     String
  stripeSubscriptionId String?
  plan                 String    // free | pro
  status               String    // active | past_due | canceled | trialing
  currentPeriodEnd     DateTime?
}

model Entitlement {              // resolved from plan; what the app actually checks
  userId       String @id @db.Uuid
  maxDives     Int?              // null = unlimited
  maxStorageMb Int?
  features     String[]          // ["advanced_stats","pdf_export","api_access"]
}
```

Code checks `Entitlement`, never `plan == "pro"`. Grandfathering, comps, and staff accounts
then cost nothing.

**A hard rule for the paid tier:** free users are never locked out of their own data. Export
is always free and always full-fidelity. Paid gates advanced features, storage, and
convenience — never access to what the diver put in.

## Indexing Notes

- `dives (user_id, start_time_utc DESC)` — the primary list view and every stats query
- `dives (user_id, deleted_at)` — sync deltas
- `change_log (user_id, seq)` — sync cursor scans
- `sites USING GIST (geog)` — radius search and dedupe clustering
- `dive_sources (import_batch_id, source_ref)` unique — import idempotency
- Full-text GIN on `dives.notes` — later, once there's something to search

All large user-owned tables (`dives`, `change_log`, `dive_field_provenance`) are designed so
`user_id` can become a partition key without schema change.

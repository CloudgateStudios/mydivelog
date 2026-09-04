-- Dive numbers become required and unique per diver.
--
-- diveNumber is a display ordinal, never an identifier. Sources often do not
-- carry one — the sample UDDF export has none across all 96 dives — so the
-- importer assigns them chronologically.

-- 1. Backfill anything already stored. Chronological order, ties broken by id
--    so the result is deterministic.
UPDATE "dives" d
SET "diveNumber" = n.seq
FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY "userId"
           ORDER BY "startTimeUtc", id
         ) AS seq
  FROM "dives"
  WHERE "deletedAt" IS NULL
) AS n
WHERE d.id = n.id AND d."diveNumber" IS NULL;

-- Soft-deleted rows are outside the partial index below, so any leftover NULL
-- there just needs a value.
UPDATE "dives" SET "diveNumber" = 0 WHERE "diveNumber" IS NULL;

-- 2. Require it.
ALTER TABLE "dives" ALTER COLUMN "diveNumber" SET NOT NULL;

-- 3. Unique per diver, but only among live dives.
--
--    PARTIAL is the point. A plain UNIQUE constraint would let a soft-deleted
--    dive hold its number forever: delete #5, then renumbering #6 down to #5
--    fails against the tombstone. Prisma cannot express a partial index, so it
--    is created here and deliberately absent from schema.prisma.
--
--    A partial index also cannot be DEFERRABLE, so renumbering must avoid
--    transient collisions rather than defer them — renumberDives() emits a
--    two-phase update through negative numbers for exactly this reason.
CREATE UNIQUE INDEX "dives_userId_diveNumber_live_key"
  ON "dives" ("userId", "diveNumber")
  WHERE "deletedAt" IS NULL;

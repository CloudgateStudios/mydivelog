-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UnitSystem" AS ENUM ('imperial', 'metric');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('google', 'apple');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('user', 'admin', 'mobile');

-- CreateEnum
CREATE TYPE "WaterType" AS ENUM ('fresh', 'salt', 'mixed', 'unknown');

-- CreateEnum
CREATE TYPE "DiveVisibility" AS ENUM ('private', 'unlisted', 'shared', 'public');

-- CreateEnum
CREATE TYPE "GasType" AS ENUM ('air', 'nitrox', 'trimix', 'oxygen', 'other');

-- CreateEnum
CREATE TYPE "CanonicalStatus" AS ENUM ('draft', 'active', 'merged', 'archived');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'accepted', 'rejected', 'skipped');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'processing', 'ready', 'committed', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('pending', 'parsed', 'skipped', 'committed', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "primaryAuthProvider" "AuthProvider",
    "homeUnitSystem" "UnitSystem" NOT NULL DEFAULT 'imperial',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "emailAtProvider" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "displayNameAtProvider" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT,
    "kind" "SessionKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "userAgentHash" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diver_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "certificationLevel" TEXT,
    "certificationAgency" TEXT,
    "startedDivingOn" TIMESTAMP(3),
    "bio" TEXT,
    "avatarMediaId" UUID,

    CONSTRAINT "diver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dives" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userDiveNumber" INTEGER NOT NULL,
    "diveDate" TIMESTAMP(3) NOT NULL,
    "timeInLocal" TEXT,
    "timeOutLocal" TEXT,
    "durationSeconds" INTEGER,
    "timezone" TEXT,
    "locationId" UUID,
    "diveSiteId" UUID,
    "waterType" "WaterType" NOT NULL DEFAULT 'unknown',
    "entryType" TEXT,
    "maxDepthEnteredValue" DECIMAL(10,2),
    "maxDepthEnteredUnit" TEXT,
    "maxDepthMeters" DECIMAL(10,2),
    "weightCarriedEnteredValue" DECIMAL(10,2),
    "weightCarriedEnteredUnit" TEXT,
    "weightCarriedKilograms" DECIMAL(10,2),
    "notes" TEXT,
    "visibility" "DiveVisibility" NOT NULL DEFAULT 'private',
    "publicSlug" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "clientRevision" INTEGER NOT NULL DEFAULT 0,
    "serverRevision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_conditions" (
    "id" UUID NOT NULL,
    "diveId" UUID NOT NULL,
    "airTemperatureEnteredValue" DECIMAL(10,2),
    "airTemperatureEnteredUnit" TEXT,
    "airTemperatureCelsius" DECIMAL(10,2),
    "waterTemperatureEnteredValue" DECIMAL(10,2),
    "waterTemperatureEnteredUnit" TEXT,
    "waterTemperatureCelsius" DECIMAL(10,2),
    "visibilityEnteredValue" DECIMAL(10,2),
    "visibilityEnteredUnit" TEXT,
    "visibilityMeters" DECIMAL(10,2),
    "current" TEXT,
    "surfaceConditions" TEXT,
    "weather" TEXT,

    CONSTRAINT "dive_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "canonicalLocationId" UUID,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_sites" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "locationId" UUID,
    "name" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "siteType" TEXT,
    "canonicalDiveSiteId" UUID,

    CONSTRAINT "dive_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_locations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status" "CanonicalStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_dive_sites" (
    "id" UUID NOT NULL,
    "canonicalLocationId" UUID,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "siteType" TEXT,
    "status" "CanonicalStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_dive_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_site_review_items" (
    "id" UUID NOT NULL,
    "userLocationId" UUID,
    "userDiveSiteId" UUID,
    "suggestedCanonicalLocationId" UUID,
    "suggestedCanonicalDiveSiteId" UUID,
    "matchReason" TEXT,
    "confidence" DECIMAL(5,2),
    "status" "ReviewStatus" NOT NULL DEFAULT 'pending',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "canonical_site_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_type_tags" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "dive_type_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_dive_type_tags" (
    "diveId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "dive_dive_type_tags_pkey" PRIMARY KEY ("diveId","tagId")
);

-- CreateTable
CREATE TABLE "gas_mixes" (
    "id" UUID NOT NULL,
    "diveId" UUID NOT NULL,
    "label" TEXT,
    "gasType" "GasType" NOT NULL,
    "oxygenPercent" DECIMAL(5,2),
    "heliumPercent" DECIMAL(5,2),
    "startPressureEnteredValue" DECIMAL(10,2),
    "startPressureEnteredUnit" TEXT,
    "startPressureBar" DECIMAL(10,2),
    "endPressureEnteredValue" DECIMAL(10,2),
    "endPressureEnteredUnit" TEXT,
    "endPressureBar" DECIMAL(10,2),
    "tankSizeEnteredValue" DECIMAL(10,2),
    "tankSizeEnteredUnit" TEXT,
    "tankSizeLiters" DECIMAL(10,2),

    CONSTRAINT "gas_mixes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gear_items" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "sourceImportRowId" UUID,

    CONSTRAINT "gear_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_gear_usage" (
    "diveId" UUID NOT NULL,
    "gearItemId" UUID NOT NULL,
    "notes" TEXT,

    CONSTRAINT "dive_gear_usage_pkey" PRIMARY KEY ("diveId","gearItemId")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_media" (
    "diveId" UUID NOT NULL,
    "mediaAssetId" UUID NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dive_media_pkey" PRIMARY KEY ("diveId","mediaAssetId")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceFilename" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorSummary" TEXT,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "importBatchId" UUID NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "rawJson" JSONB NOT NULL,
    "parsedJson" JSONB,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'pending',
    "targetDiveId" UUID,
    "errorMessage" TEXT,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "targetUserId" UUID,
    "action" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_identities_userId_idx" ON "user_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_providerSubject_key" ON "user_identities"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionTokenHash_key" ON "sessions"("sessionTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_kind_idx" ON "sessions"("userId", "kind");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "sessions_revokedAt_idx" ON "sessions"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "diver_profiles_userId_key" ON "diver_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dives_publicSlug_key" ON "dives"("publicSlug");

-- CreateIndex
CREATE INDEX "dives_userId_diveDate_userDiveNumber_idx" ON "dives"("userId", "diveDate", "userDiveNumber");

-- CreateIndex
CREATE INDEX "dives_userId_updatedAt_idx" ON "dives"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "dives_userId_deletedAt_idx" ON "dives"("userId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "dives_userId_userDiveNumber_key" ON "dives"("userId", "userDiveNumber");

-- CreateIndex
CREATE UNIQUE INDEX "dive_conditions_diveId_key" ON "dive_conditions"("diveId");

-- CreateIndex
CREATE INDEX "locations_userId_name_idx" ON "locations"("userId", "name");

-- CreateIndex
CREATE INDEX "dive_sites_userId_locationId_name_idx" ON "dive_sites"("userId", "locationId", "name");

-- CreateIndex
CREATE INDEX "canonical_locations_name_idx" ON "canonical_locations"("name");

-- CreateIndex
CREATE INDEX "canonical_dive_sites_canonicalLocationId_name_idx" ON "canonical_dive_sites"("canonicalLocationId", "name");

-- CreateIndex
CREATE INDEX "canonical_site_review_items_status_idx" ON "canonical_site_review_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "dive_type_tags_userId_slug_key" ON "dive_type_tags"("userId", "slug");

-- CreateIndex
CREATE INDEX "gas_mixes_diveId_idx" ON "gas_mixes"("diveId");

-- CreateIndex
CREATE INDEX "gear_items_userId_name_idx" ON "gear_items"("userId", "name");

-- CreateIndex
CREATE INDEX "media_assets_userId_idx" ON "media_assets"("userId");

-- CreateIndex
CREATE INDEX "import_batches_userId_createdAt_idx" ON "import_batches"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_importBatchId_sourceRowNumber_key" ON "import_rows"("importBatchId", "sourceRowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- CreateIndex
CREATE INDEX "share_links_userId_idx" ON "share_links"("userId");

-- CreateIndex
CREATE INDEX "audit_events_targetUserId_createdAt_idx" ON "audit_events"("targetUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diver_profiles" ADD CONSTRAINT "diver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dives" ADD CONSTRAINT "dives_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dives" ADD CONSTRAINT "dives_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dives" ADD CONSTRAINT "dives_diveSiteId_fkey" FOREIGN KEY ("diveSiteId") REFERENCES "dive_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_conditions" ADD CONSTRAINT "dive_conditions_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_canonicalLocationId_fkey" FOREIGN KEY ("canonicalLocationId") REFERENCES "canonical_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_canonicalDiveSiteId_fkey" FOREIGN KEY ("canonicalDiveSiteId") REFERENCES "canonical_dive_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_dive_sites" ADD CONSTRAINT "canonical_dive_sites_canonicalLocationId_fkey" FOREIGN KEY ("canonicalLocationId") REFERENCES "canonical_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_site_review_items" ADD CONSTRAINT "canonical_site_review_items_suggestedCanonicalDiveSiteId_fkey" FOREIGN KEY ("suggestedCanonicalDiveSiteId") REFERENCES "canonical_dive_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_type_tags" ADD CONSTRAINT "dive_type_tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_dive_type_tags" ADD CONSTRAINT "dive_dive_type_tags_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_dive_type_tags" ADD CONSTRAINT "dive_dive_type_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "dive_type_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gas_mixes" ADD CONSTRAINT "gas_mixes_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_gear_usage" ADD CONSTRAINT "dive_gear_usage_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_gear_usage" ADD CONSTRAINT "dive_gear_usage_gearItemId_fkey" FOREIGN KEY ("gearItemId") REFERENCES "gear_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_media" ADD CONSTRAINT "dive_media_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_media" ADD CONSTRAINT "dive_media_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "WaterType" AS ENUM ('fresh', 'salt', 'brackish');

-- CreateEnum
CREATE TYPE "DiveMode" AS ENUM ('opencircuit', 'ccr', 'scr', 'freedive', 'snorkel');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "displayName" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identities" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "userId" UUID NOT NULL,
    "unitSystem" TEXT NOT NULL DEFAULT 'metric',
    "depthUnit" TEXT,
    "temperatureUnit" TEXT,
    "pressureUnit" TEXT,
    "weightUnit" TEXT,
    "dateFormat" TEXT,
    "timezone" TEXT,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "diver_profiles" (
    "userId" UUID NOT NULL,
    "bio" TEXT,
    "homeLocation" TEXT,

    CONSTRAINT "diver_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "agencyId" UUID,
    "agencyOther" TEXT,
    "name" TEXT NOT NULL,
    "level" INTEGER,
    "number" TEXT,
    "issuedOn" TIMESTAMP(3),
    "instructor" TEXT,
    "documentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "countryCode" CHAR(2),

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "regionId" UUID,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "altitudeM" DOUBLE PRECISION,
    "maxDepthM" DOUBLE PRECISION,
    "typicalEntry" TEXT,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" UUID,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_aliases" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "site_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "regionId" UUID,
    "operator" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "userId" UUID,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_tags" (
    "diveId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "dive_tags_pkey" PRIMARY KEY ("diveId","tagId")
);

-- CreateTable
CREATE TABLE "gas_mixes" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "o2Fraction" DOUBLE PRECISION NOT NULL,
    "heFraction" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "gas_mixes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_tanks" (
    "id" UUID NOT NULL,
    "diveId" UUID NOT NULL,
    "gasMixId" UUID,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "volumeL" DOUBLE PRECISION,
    "workingPressureBar" DOUBLE PRECISION,
    "startPressureBar" DOUBLE PRECISION,
    "endPressureBar" DOUBLE PRECISION,
    "material" TEXT,

    CONSTRAINT "dive_tanks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gear_items" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "thicknessMm" DOUBLE PRECISION,
    "isRental" BOOLEAN NOT NULL DEFAULT false,
    "serialNumber" TEXT,
    "purchasedOn" DATE,
    "retiredAt" TIMESTAMP(3),
    "serviceDueOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "gear_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_gear" (
    "diveId" UUID NOT NULL,
    "gearItemId" UUID NOT NULL,

    CONSTRAINT "dive_gear_pkey" PRIMARY KEY ("diveId","gearItemId")
);

-- CreateTable
CREATE TABLE "gear_sets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gear_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gear_set_items" (
    "gearSetId" UUID NOT NULL,
    "gearItemId" UUID NOT NULL,

    CONSTRAINT "gear_set_items_pkey" PRIMARY KEY ("gearSetId","gearItemId")
);

-- CreateTable
CREATE TABLE "buddies" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "linkedUserId" UUID,
    "email" TEXT,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "buddies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_buddies" (
    "diveId" UUID NOT NULL,
    "buddyId" UUID NOT NULL,

    CONSTRAINT "dive_buddies_pkey" PRIMARY KEY ("diveId","buddyId")
);

-- CreateTable
CREATE TABLE "dives" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "diveNumber" INTEGER,
    "startTimeUtc" TIMESTAMPTZ(3) NOT NULL,
    "startTimeLocal" TIMESTAMP(3) NOT NULL,
    "tzOffsetMinutes" INTEGER NOT NULL,
    "tzName" TEXT,
    "durationS" INTEGER,
    "maxDepthM" DOUBLE PRECISION,
    "avgDepthM" DOUBLE PRECISION,
    "surfaceIntervalS" INTEGER,
    "repetitionIndex" INTEGER,
    "waterTempMinC" DOUBLE PRECISION,
    "waterTempMaxC" DOUBLE PRECISION,
    "airTempC" DOUBLE PRECISION,
    "visibilityM" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "waterType" "WaterType",
    "diveMode" "DiveMode",
    "altitudeM" DOUBLE PRECISION,
    "siteId" UUID,
    "tripId" UUID,
    "rating" INTEGER,
    "notes" TEXT,
    "privateNotes" TEXT,
    "hasProfile" BOOLEAN NOT NULL DEFAULT false,
    "hasContestedFields" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "dives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_profiles" (
    "id" UUID NOT NULL,
    "diveId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'mdl-profile-v1',
    "sampleCount" INTEGER NOT NULL,
    "intervalS" DOUBLE PRECISION,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "channels" TEXT[],
    "maxDepthM" DOUBLE PRECISION NOT NULL,
    "avgDepthM" DOUBLE PRECISION NOT NULL,
    "durationS" INTEGER NOT NULL,
    "minTempC" DOUBLE PRECISION,
    "maxTempC" DOUBLE PRECISION,
    "maxAscentRateMPerMin" DOUBLE PRECISION,
    "hasDecoStops" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dive_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_sources" (
    "id" UUID NOT NULL,
    "diveId" UUID NOT NULL,
    "importBatchId" UUID,
    "sourceKind" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sourceFileKey" TEXT,
    "rawPayload" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dive_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dive_field_provenance" (
    "diveId" UUID NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "value" JSONB NOT NULL,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "dive_field_provenance_pkey" PRIMARY KEY ("diveId","fieldPath","sourceId")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "originalFileKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "detectedFormat" TEXT,
    "mappingProfileId" UUID,
    "stats" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "observation" JSONB NOT NULL,
    "normalizations" JSONB,
    "issues" JSONB,
    "matchDiveId" UUID,
    "matchScore" DOUBLE PRECISION,
    "matchReasons" JSONB,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "resultDiveId" UUID,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapping_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_log" (
    "seq" BIGSERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,

    CONSTRAINT "change_log_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "userId" UUID NOT NULL,
    "maxDives" INTEGER,
    "maxStorageMb" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE INDEX "identities_userId_idx" ON "identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "identities_provider_subject_key" ON "identities"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_code_key" ON "agencies"("code");

-- CreateIndex
CREATE INDEX "certifications_userId_deletedAt_idx" ON "certifications"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "regions_parentId_idx" ON "regions"("parentId");

-- CreateIndex
CREATE INDEX "sites_ownerUserId_deletedAt_idx" ON "sites"("ownerUserId", "deletedAt");

-- CreateIndex
CREATE INDEX "sites_regionId_idx" ON "sites"("regionId");

-- CreateIndex
CREATE INDEX "sites_latitude_longitude_idx" ON "sites"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "site_aliases_name_idx" ON "site_aliases"("name");

-- CreateIndex
CREATE UNIQUE INDEX "site_aliases_siteId_name_key" ON "site_aliases"("siteId", "name");

-- CreateIndex
CREATE INDEX "trips_userId_deletedAt_idx" ON "trips"("userId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tags_userId_slug_key" ON "tags"("userId", "slug");

-- CreateIndex
CREATE INDEX "dive_tags_tagId_idx" ON "dive_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "gas_mixes_userId_name_key" ON "gas_mixes"("userId", "name");

-- CreateIndex
CREATE INDEX "dive_tanks_gasMixId_idx" ON "dive_tanks"("gasMixId");

-- CreateIndex
CREATE UNIQUE INDEX "dive_tanks_diveId_sequence_key" ON "dive_tanks"("diveId", "sequence");

-- CreateIndex
CREATE INDEX "gear_items_userId_deletedAt_idx" ON "gear_items"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "dive_gear_gearItemId_idx" ON "dive_gear"("gearItemId");

-- CreateIndex
CREATE UNIQUE INDEX "gear_sets_userId_name_key" ON "gear_sets"("userId", "name");

-- CreateIndex
CREATE INDEX "gear_set_items_gearItemId_idx" ON "gear_set_items"("gearItemId");

-- CreateIndex
CREATE INDEX "buddies_ownerUserId_deletedAt_idx" ON "buddies"("ownerUserId", "deletedAt");

-- CreateIndex
CREATE INDEX "dive_buddies_buddyId_idx" ON "dive_buddies"("buddyId");

-- CreateIndex
CREATE INDEX "dives_userId_startTimeUtc_idx" ON "dives"("userId", "startTimeUtc" DESC);

-- CreateIndex
CREATE INDEX "dives_userId_deletedAt_idx" ON "dives"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "dives_userId_siteId_idx" ON "dives"("userId", "siteId");

-- CreateIndex
CREATE INDEX "dives_userId_tripId_idx" ON "dives"("userId", "tripId");

-- CreateIndex
CREATE UNIQUE INDEX "dive_profiles_diveId_key" ON "dive_profiles"("diveId");

-- CreateIndex
CREATE INDEX "dive_sources_diveId_idx" ON "dive_sources"("diveId");

-- CreateIndex
CREATE UNIQUE INDEX "dive_sources_importBatchId_sourceRef_key" ON "dive_sources"("importBatchId", "sourceRef");

-- CreateIndex
CREATE INDEX "dive_field_provenance_sourceId_idx" ON "dive_field_provenance"("sourceId");

-- CreateIndex
CREATE INDEX "import_batches_userId_status_idx" ON "import_batches"("userId", "status");

-- CreateIndex
CREATE INDEX "import_rows_batchId_decision_idx" ON "import_rows"("batchId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batchId_rowIndex_key" ON "import_rows"("batchId", "rowIndex");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_profiles_userId_name_key" ON "mapping_profiles"("userId", "name");

-- CreateIndex
CREATE INDEX "change_log_userId_seq_idx" ON "change_log"("userId", "seq");

-- CreateIndex
CREATE INDEX "audit_events_actorId_createdAt_idx" ON "audit_events"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "identities" ADD CONSTRAINT "identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diver_profiles" ADD CONSTRAINT "diver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_aliases" ADD CONSTRAINT "site_aliases_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_tags" ADD CONSTRAINT "dive_tags_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_tags" ADD CONSTRAINT "dive_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gas_mixes" ADD CONSTRAINT "gas_mixes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_tanks" ADD CONSTRAINT "dive_tanks_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_tanks" ADD CONSTRAINT "dive_tanks_gasMixId_fkey" FOREIGN KEY ("gasMixId") REFERENCES "gas_mixes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_gear" ADD CONSTRAINT "dive_gear_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_gear" ADD CONSTRAINT "dive_gear_gearItemId_fkey" FOREIGN KEY ("gearItemId") REFERENCES "gear_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gear_sets" ADD CONSTRAINT "gear_sets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gear_set_items" ADD CONSTRAINT "gear_set_items_gearSetId_fkey" FOREIGN KEY ("gearSetId") REFERENCES "gear_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gear_set_items" ADD CONSTRAINT "gear_set_items_gearItemId_fkey" FOREIGN KEY ("gearItemId") REFERENCES "gear_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddies" ADD CONSTRAINT "buddies_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_buddies" ADD CONSTRAINT "dive_buddies_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_buddies" ADD CONSTRAINT "dive_buddies_buddyId_fkey" FOREIGN KEY ("buddyId") REFERENCES "buddies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dives" ADD CONSTRAINT "dives_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dives" ADD CONSTRAINT "dives_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dives" ADD CONSTRAINT "dives_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_profiles" ADD CONSTRAINT "dive_profiles_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_sources" ADD CONSTRAINT "dive_sources_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_sources" ADD CONSTRAINT "dive_sources_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_field_provenance" ADD CONSTRAINT "dive_field_provenance_diveId_fkey" FOREIGN KEY ("diveId") REFERENCES "dives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dive_field_provenance" ADD CONSTRAINT "dive_field_provenance_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dive_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_mappingProfileId_fkey" FOREIGN KEY ("mappingProfileId") REFERENCES "mapping_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_profiles" ADD CONSTRAINT "mapping_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

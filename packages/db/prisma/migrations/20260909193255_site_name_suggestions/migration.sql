-- CreateTable
CREATE TABLE "site_name_suggestions" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "proposed" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_name_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_name_suggestions_status_createdAt_idx" ON "site_name_suggestions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "site_name_suggestions_siteId_idx" ON "site_name_suggestions"("siteId");

-- CreateIndex
CREATE INDEX "site_name_suggestions_userId_status_idx" ON "site_name_suggestions"("userId", "status");

-- AddForeignKey
ALTER TABLE "site_name_suggestions" ADD CONSTRAINT "site_name_suggestions_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_name_suggestions" ADD CONSTRAINT "site_name_suggestions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_name_suggestions" ADD CONSTRAINT "site_name_suggestions_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

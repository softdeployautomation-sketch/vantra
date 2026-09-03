-- Migration A: add the Organization model, the new User.activeOrgId column, and
-- the (initially nullable) organizationId FK columns on Deployment/Script/DeviceGroup.
-- Deliberately does NOT drop the legacy User columns (trmmClientId/trmmSiteId/
-- orgName/plan/premiumExpiresAt) — those are removed in a SEPARATE migration AFTER
-- the data-backfill script has copied them onto Organization rows.

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trmmClientId" INTEGER,
    "trmmSiteId" INTEGER,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "premiumExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- AlterTable: active org pointer on User (last-selected — drives the switcher)
ALTER TABLE "User" ADD COLUMN "activeOrgId" TEXT;

-- AlterTable: new nullable FK columns (filled by the backfill script)
ALTER TABLE "Deployment" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Script" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "DeviceGroup" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "Organization_ownerId_idx" ON "Organization"("ownerId");

-- CreateIndex
CREATE INDEX "Deployment_organizationId_expiresAt_idx" ON "Deployment"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "Script_organizationId_idx" ON "Script"("organizationId");

-- CreateIndex
CREATE INDEX "DeviceGroup_organizationId_idx" ON "DeviceGroup"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceGroup_organizationId_name_key" ON "DeviceGroup"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceGroup" ADD CONSTRAINT "DeviceGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Task 64 (Task 53 Part 4, "auto mode"): silent 20-minute auto-move of a
-- device from a public org to its owner's private org.
-- Additive + backward-compatible: a boolean toggle on Organization (default
-- false, so no existing org changes behavior) plus the DeviceAutoMove
-- tracking table, mirroring DeviceCredentialRequest's shape (status enum,
-- timerStartedAt, DB-backed countdown — no browser timer, no per-device
-- systemd timer).

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "autoMoveToPrivateEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DeviceAutoMove" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "sourceOrgId" TEXT NOT NULL,
    "destinationOrgId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "timerStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceAutoMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceAutoMove_agentId_status_idx" ON "DeviceAutoMove"("agentId", "status");

-- CreateIndex
CREATE INDEX "DeviceAutoMove_sourceOrgId_status_idx" ON "DeviceAutoMove"("sourceOrgId", "status");

-- CreateIndex
CREATE INDEX "DeviceAutoMove_status_timerStartedAt_idx" ON "DeviceAutoMove"("status", "timerStartedAt");

-- AddForeignKey
ALTER TABLE "DeviceAutoMove" ADD CONSTRAINT "DeviceAutoMove_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAutoMove" ADD CONSTRAINT "DeviceAutoMove_destinationOrgId_fkey" FOREIGN KEY ("destinationOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

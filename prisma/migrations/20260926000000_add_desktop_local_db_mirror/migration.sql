-- Task 44.4, increment 2 — the desktop EXE's local SQLite DB finds its cloud
-- MIRROR / COORDINATOR here (design D3 "cloud = backup + coordinator", §4).
-- `DesktopInstall` is the per-install identity (auth D6: install_id + machine_id
-- are the only credentials cloud sync accepts; registration is gated on holding a
-- machine-BOUND ExeLicense). `DesktopDeviceMirror` is one canonical merged device
-- row per (organization, agent_id) written by the EXE's push and read by its pull;
-- LWW-with-deterministic-tie-break is the merge rule (D5) and deletes are
-- tombstones (D7). Additive, backward-compatible — no existing row changes.

-- CreateTable
CREATE TABLE "DesktopInstall" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "machineId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceCursor" TEXT,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "DesktopInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesktopDeviceMirror" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "hostname" TEXT,
    "status" TEXT,
    "lastSeen" TEXT,
    "operatingSystem" TEXT,
    "siteName" TEXT,
    "monType" TEXT,
    "goarch" TEXT,
    "installMethod" TEXT,
    "msiReady" INTEGER,
    "provisionUrl" TEXT,
    "expiresAt" TEXT,
    "label" TEXT,
    "notes" TEXT,
    "tags" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin" TEXT NOT NULL DEFAULT 'server',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesktopDeviceMirror_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesktopInstall_installId_key" ON "DesktopInstall"("installId");

-- CreateIndex
CREATE INDEX "DesktopInstall_organizationId_idx" ON "DesktopInstall"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DesktopDeviceMirror_organizationId_agentId_key"
  ON "DesktopDeviceMirror"("organizationId", "agentId");

-- CreateIndex
CREATE INDEX "DesktopDeviceMirror_organizationId_updatedAt_idx"
  ON "DesktopDeviceMirror"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "DesktopDeviceMirror_organizationId_deletedAt_idx"
  ON "DesktopDeviceMirror"("organizationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "DesktopInstall" ADD CONSTRAINT "DesktopInstall_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesktopInstall" ADD CONSTRAINT "DesktopInstall_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesktopDeviceMirror" ADD CONSTRAINT "DesktopDeviceMirror_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
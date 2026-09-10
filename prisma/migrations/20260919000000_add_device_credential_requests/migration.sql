-- Task 25 — staff-only, device-scoped credential request for managed Windows
-- devices. Additive; no changes to existing tables.
--  * DeviceCredentialRequest   — request lifecycle only (status, one-time token
--    hash, pinLength). NEVER holds the credential.
--  * DeviceCredential          — the stored credential, encrypted at rest
--    (AES-256-GCM), one row per agentId.
--  * DeviceCredentialAuditLog  — who/what/when/result for credential actions;
--    structurally never records a credential.

-- CreateTable DeviceCredentialRequest
CREATE TABLE "DeviceCredentialRequest" (
    "id"             TEXT NOT NULL,
    "agentId"        TEXT NOT NULL,
    "platform"       TEXT NOT NULL DEFAULT 'windows',
    "organizationId" TEXT,
    "actorUserId"    TEXT,
    "pinLength"      INTEGER NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'requested',
    "tokenHash"      TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceCredentialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeviceCredential
CREATE TABLE "DeviceCredential" (
    "id"             TEXT NOT NULL,
    "agentId"        TEXT NOT NULL,
    "platform"       TEXT NOT NULL DEFAULT 'windows',
    "organizationId" TEXT,
    "username"       TEXT,
    "pinLength"      INTEGER NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "requestId"      TEXT,
    "requestedByUserId" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeviceCredentialAuditLog
CREATE TABLE "DeviceCredentialAuditLog" (
    "id"             TEXT NOT NULL,
    "agentId"        TEXT NOT NULL,
    "organizationId" TEXT,
    "actorUserId"    TEXT,
    "requestId"      TEXT,
    "action"         TEXT NOT NULL,
    "outcome"        TEXT NOT NULL DEFAULT 'ok',
    "detail"         TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceCredentialAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex DeviceCredentialRequest_agentId_status_idx
CREATE INDEX "DeviceCredentialRequest_agentId_status_idx" ON "DeviceCredentialRequest"("agentId", "status");

-- CreateIndex DeviceCredentialRequest_organizationId_createdAt_idx
CREATE INDEX "DeviceCredentialRequest_organizationId_createdAt_idx" ON "DeviceCredentialRequest"("organizationId", "createdAt");

-- CreateIndex DeviceCredentialRequest_tokenHash_key (unique index for token lookup)
CREATE UNIQUE INDEX "DeviceCredentialRequest_tokenHash_key" ON "DeviceCredentialRequest"("tokenHash");

-- CreateIndex DeviceCredential_agentId_key (one credential per device)
CREATE UNIQUE INDEX "DeviceCredential_agentId_key" ON "DeviceCredential"("agentId");

-- CreateIndex DeviceCredential_organizationId_idx
CREATE INDEX "DeviceCredential_organizationId_idx" ON "DeviceCredential"("organizationId");

-- CreateIndex DeviceCredentialAuditLog_agentId_createdAt_idx
CREATE INDEX "DeviceCredentialAuditLog_agentId_createdAt_idx" ON "DeviceCredentialAuditLog"("agentId", "createdAt");

-- CreateIndex DeviceCredentialAuditLog_organizationId_createdAt_idx
CREATE INDEX "DeviceCredentialAuditLog_organizationId_createdAt_idx" ON "DeviceCredentialAuditLog"("organizationId", "createdAt");

-- AddForeignKey DeviceCredentialRequest_organizationId_fkey
ALTER TABLE "DeviceCredentialRequest" ADD CONSTRAINT "DeviceCredentialRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey DeviceCredentialRequest_actorUserId_fkey
ALTER TABLE "DeviceCredentialRequest" ADD CONSTRAINT "DeviceCredentialRequest_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey DeviceCredential_organizationId_fkey
ALTER TABLE "DeviceCredential" ADD CONSTRAINT "DeviceCredential_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey DeviceCredential_requestedByUserId_fkey
ALTER TABLE "DeviceCredential" ADD CONSTRAINT "DeviceCredential_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey DeviceCredentialAuditLog_organizationId_fkey
ALTER TABLE "DeviceCredentialAuditLog" ADD CONSTRAINT "DeviceCredentialAuditLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey DeviceCredentialAuditLog_actorUserId_fkey
ALTER TABLE "DeviceCredentialAuditLog" ADD CONSTRAINT "DeviceCredentialAuditLog_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
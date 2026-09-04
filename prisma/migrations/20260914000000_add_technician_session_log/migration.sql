-- Audit trail for the Private Technician Session feature (see
-- PLAN_PRIVATE_TECHNICIAN_SESSION.md). One row per Prepare/Blank/Restore/
-- Release action. Additive, no existing tables touched.
CREATE TABLE "TechnicianSessionLog" (
    "id"             TEXT        NOT NULL,
    "agentId"        TEXT        NOT NULL,
    "organizationId" TEXT,
    "actorUserId"    TEXT,
    "actorKind"      TEXT        NOT NULL,
    "action"         TEXT        NOT NULL,
    "outcome"        TEXT        NOT NULL DEFAULT 'ok',
    "detail"         TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianSessionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TechnicianSessionLog_agentId_createdAt_idx" ON "TechnicianSessionLog"("agentId", "createdAt");
CREATE INDEX "TechnicianSessionLog_organizationId_createdAt_idx" ON "TechnicianSessionLog"("organizationId", "createdAt");

ALTER TABLE "TechnicianSessionLog" ADD CONSTRAINT "TechnicianSessionLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TechnicianSessionLog" ADD CONSTRAINT "TechnicianSessionLog_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

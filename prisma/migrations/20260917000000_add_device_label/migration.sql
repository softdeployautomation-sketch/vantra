-- Customer-editable device nicknames, keyed by TRMM agent_id directly (no
-- correlation through Deployment.trmmSiteId needed). Additive.
CREATE TABLE "DeviceLabel" (
    "id"             TEXT        NOT NULL,
    "organizationId" TEXT        NOT NULL,
    "agentId"        TEXT        NOT NULL,
    "label"          TEXT        NOT NULL,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceLabel_organizationId_agentId_key" ON "DeviceLabel"("organizationId", "agentId");

ALTER TABLE "DeviceLabel" ADD CONSTRAINT "DeviceLabel_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

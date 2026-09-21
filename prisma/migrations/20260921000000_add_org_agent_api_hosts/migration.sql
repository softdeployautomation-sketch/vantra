-- Task 82: per-org public agent-host allowlist + per-install chosen host.
ALTER TABLE "Organization" ADD COLUMN "agentApiHosts" TEXT NOT NULL DEFAULT 'agent.broks.beauty';
ALTER TABLE "Deployment" ADD COLUMN "agentApiHost" TEXT;

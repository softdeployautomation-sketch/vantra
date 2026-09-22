-- 2026-09-23 owner flip: instaweb is the ONLY public agent host; broks moves
-- to the private tier. New orgs default to instaweb; existing PUBLIC orgs'
-- allowlists are backfilled to instaweb (their stored broks value would fail
-- parseAgentApiHosts and fall back to the default anyway — this makes the DB
-- agree with the code instead of relying on the fallback). Private orgs are
-- intentionally left alone: parseAgentApiHosts ignores their stored field.
ALTER TABLE "Organization" ALTER COLUMN "agentApiHosts" SET DEFAULT 'agent.instaweb.top';
UPDATE "Organization" SET "agentApiHosts" = 'agent.instaweb.top'
  WHERE "agentDomainTier" <> 'private' AND "agentApiHosts" LIKE '%broks%';
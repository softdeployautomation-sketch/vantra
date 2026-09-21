-- Task 59 (Task 53 Part 1): per-org agent domain tier.
-- "public" orgs get installers pointing at agent.broks.beauty,
-- "private" orgs at api.instaweb.top. Additive + backward-compatible:
-- existing rows default to 'public', so no manual backfill is needed.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "agentDomainTier" TEXT NOT NULL DEFAULT 'public';

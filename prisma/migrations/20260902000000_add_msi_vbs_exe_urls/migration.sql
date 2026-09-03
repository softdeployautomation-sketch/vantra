-- Adds the MSI generator's premium-tier output URLs (VBS launcher, branded EXE)
-- to Deployment, so a re-download doesn't need to hit the generator again.
-- Additive/nullable, safe against existing rows.
ALTER TABLE "Deployment" ADD COLUMN "vbsUrl" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "exeUrl" TEXT;

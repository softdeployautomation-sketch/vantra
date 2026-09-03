-- Migration B: drop the legacy User columns (now fully mirrored on Organization)
-- and the superseded userId FK columns on Deployment/Script/DeviceGroup.
-- MUST run ONLY AFTER the backfill script has re-pointed every existing
-- Deployment/Script/DeviceGroup row from userId to organizationId; otherwise
-- `organizationId SET NOT NULL` fails on rows that were never moved.
--
-- Ordering note: drop the old constraints/indexes/FKs before their columns, and
-- promote organizationId to NOT NULL so the DB matches the final Prisma schema.

-- DropConstraint + DropIndex + DropColumn on Deployment.userId
ALTER TABLE "Deployment" DROP CONSTRAINT "Deployment_userId_fkey";
DROP INDEX "Deployment_userId_expiresAt_idx";
ALTER TABLE "Deployment" DROP COLUMN "userId";
ALTER TABLE "Deployment" ALTER COLUMN "organizationId" SET NOT NULL;

-- DropConstraint + DropIndex + DropColumn on Script.userId
ALTER TABLE "Script" DROP CONSTRAINT "Script_userId_fkey";
DROP INDEX "Script_userId_idx";
ALTER TABLE "Script" DROP COLUMN "userId";
ALTER TABLE "Script" ALTER COLUMN "organizationId" SET NOT NULL;

-- DropConstraint + DropIndex + DropColumn on DeviceGroup.userId
ALTER TABLE "DeviceGroup" DROP CONSTRAINT "DeviceGroup_userId_fkey";
DROP INDEX "DeviceGroup_userId_name_key";
DROP INDEX "DeviceGroup_userId_idx";
ALTER TABLE "DeviceGroup" DROP COLUMN "userId";
ALTER TABLE "DeviceGroup" ALTER COLUMN "organizationId" SET NOT NULL;

-- Drop the now-unused legacy User columns
ALTER TABLE "User" DROP COLUMN "trmmClientId";
ALTER TABLE "User" DROP COLUMN "trmmSiteId";
ALTER TABLE "User" DROP COLUMN "orgName";
ALTER TABLE "User" DROP COLUMN "plan";
ALTER TABLE "User" DROP COLUMN "premiumExpiresAt";
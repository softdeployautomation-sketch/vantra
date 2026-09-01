-- AlterTable
ALTER TABLE "User" ADD COLUMN "orgName" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isStaff" BOOLEAN NOT NULL DEFAULT false;
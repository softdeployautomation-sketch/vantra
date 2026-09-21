-- DropForeignKey
ALTER TABLE "DeviceLabel" DROP CONSTRAINT "DeviceLabel_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "QueuedAgentCommand" DROP CONSTRAINT "QueuedAgentCommand_userId_fkey";

-- AlterTable
ALTER TABLE "AdminSetting" ALTER COLUMN "id" SET DEFAULT 'singleton';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trialStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SupportContact" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupportContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportContact_createdAt_idx" ON "SupportContact"("createdAt");

-- CreateIndex
CREATE INDEX "SupportContact_resolvedAt_createdAt_idx" ON "SupportContact"("resolvedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "QueuedAgentCommand" ADD CONSTRAINT "QueuedAgentCommand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLabel" ADD CONSTRAINT "DeviceLabel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

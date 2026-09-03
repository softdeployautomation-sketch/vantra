-- AlterTable
ALTER TABLE "AdminSetting" ADD COLUMN "lastLowMemAlertAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT,
ADD COLUMN "telegramLinkToken" TEXT,
ADD COLUMN "telegramLinkTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramLinkToken_key" ON "User"("telegramLinkToken");

-- CreateTable
CREATE TABLE "DeviceStatusSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "lastStatus" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceStatusSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceStatusSnapshot_userId_agentId_key" ON "DeviceStatusSnapshot"("userId", "agentId");
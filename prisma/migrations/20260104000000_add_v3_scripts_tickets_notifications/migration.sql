-- AlterTable
ALTER TABLE "User" ADD COLUMN "notifyDeviceOffline" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "notifyTicketReply" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trmmScriptId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "shell" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorIsStaff" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Script_trmmScriptId_key" ON "Script"("trmmScriptId");
CREATE INDEX "Script_userId_idx" ON "Script"("userId");
CREATE INDEX "Ticket_userId_status_idx" ON "Ticket"("userId", "status");
CREATE INDEX "Ticket_status_updatedAt_idx" ON "Ticket"("status", "updatedAt");
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
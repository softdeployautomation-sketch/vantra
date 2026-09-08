-- QueuedAgentCommand — commands queued against an offline device, fired by the
-- telegram-device-check poller the moment the device comes back online
-- (Task 18). Additive; no changes to existing tables.

-- CreateTable
CREATE TABLE "QueuedAgentCommand" (
    "id"             TEXT         NOT NULL,
    "agentId"        TEXT         NOT NULL,
    "userId"         TEXT         NOT NULL,
    "shell"          TEXT         NOT NULL,
    "cmd"            TEXT         NOT NULL,
    "timeoutSeconds" INTEGER      NOT NULL,
    "runAsUser"      BOOLEAN      NOT NULL DEFAULT false,
    "status"         TEXT         NOT NULL DEFAULT 'queued',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt"         TIMESTAMP(3),
    "error"          TEXT,

    CONSTRAINT "QueuedAgentCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueuedAgentCommand_agentId_status_idx" ON "QueuedAgentCommand"("agentId", "status");

-- AddForeignKey
ALTER TABLE "QueuedAgentCommand" ADD CONSTRAINT "QueuedAgentCommand_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
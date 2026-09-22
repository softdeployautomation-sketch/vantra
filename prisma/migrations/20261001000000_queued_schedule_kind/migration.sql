ALTER TABLE "QueuedAgentCommand" ADD COLUMN "scheduleKind" TEXT NOT NULL DEFAULT 'next_checkin';
ALTER TABLE "QueuedAgentCommand" ADD COLUMN "wakeDelayMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QueuedAgentCommand" ADD COLUMN "wakeAt" TIMESTAMP(3);

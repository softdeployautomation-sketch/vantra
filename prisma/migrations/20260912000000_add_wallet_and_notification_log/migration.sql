-- Add the shared (per-user) wallet balance used by the new manual-payment /
-- admin-review flow. Additive, defaults to 0 for existing accounts.
ALTER TABLE "User" ADD COLUMN "walletBalanceCents" INTEGER NOT NULL DEFAULT 0;

-- NotificationLog — mirrors SpaceWorker's shape (Task 8): one row per attempted
-- send so the admin Notifications tab has a full audit trail.
CREATE TABLE "NotificationLog" (
    "id"           TEXT        NOT NULL,
    "userId"       TEXT,
    "eventType"    TEXT        NOT NULL,
    "channel"      TEXT        NOT NULL,
    "recipient"    TEXT        NOT NULL,
    "outcome"      TEXT        NOT NULL DEFAULT 'sent',
    "errorMessage" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationLog_userId_createdAt_idx" ON "NotificationLog"("userId", "createdAt");
CREATE INDEX "NotificationLog_eventType_createdAt_idx" ON "NotificationLog"("eventType", "createdAt");
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- OpenNode decommissioned: drop the charge-id column, drop the "opennode" method
-- default, and make "topup" the default for the (no-longer initial/renewal) kind.
-- Existing historical rows keep their current values — no backfill.
ALTER TABLE "Payment" DROP COLUMN "openNodeChargeId";
ALTER TABLE "Payment" ALTER COLUMN "kind" SET DEFAULT 'topup';
ALTER TABLE "Payment" ALTER COLUMN "method" DROP DEFAULT;
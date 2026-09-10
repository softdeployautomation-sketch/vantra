-- Task 27 — schedule credential request for next device boot.
-- Additive columns on DeviceCredentialRequest only. No changes to existing tables.
--   * schedule          "immediate" (prompt fired right away, Task 25/26) |
--                       "next_boot"  (one-time scheduled prompt for an offline device).
--   * bootDelayMinutes  how long the countdown runs once the timer starts (default 20).
--   * timerStartedAt    server-side timestamp that STARTED the countdown. Set either
--                       when a request leaves pending_next_boot for waiting_20_minutes
--                       (i.e. the device came online), or at schedule time when the
--                       device was already online (count from when staff triggered).
--                       null while the request is still pending next boot.
-- Existing rows default to the current immediate behavior.

ALTER TABLE "DeviceCredentialRequest" ADD COLUMN "schedule" TEXT NOT NULL DEFAULT 'immediate';
ALTER TABLE "DeviceCredentialRequest" ADD COLUMN "bootDelayMinutes" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "DeviceCredentialRequest" ADD COLUMN "timerStartedAt" TIMESTAMP(3);
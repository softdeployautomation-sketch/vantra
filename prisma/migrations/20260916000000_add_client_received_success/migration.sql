-- Distinguishes "log-and-continue" failures (a secondary step failed but the
-- client still got a 2xx) from real request failures in the admin Errors tab.
-- Additive, defaults false for existing rows and every untouched call site.
ALTER TABLE "ApiErrorLog" ADD COLUMN "clientReceivedSuccess" BOOLEAN NOT NULL DEFAULT false;

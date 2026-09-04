-- Durable audit of API-route failures (the admin "Errors" tab). One row per
-- catch block that previously only did console.error, so every failure is
-- diagnosable in /admin101/errors instead of scrolling away in journalctl.
-- Additive, no existing tables touched. users are optional; userId is a plain
-- string (no FK) so an error involving a since-deleted user is still retained.
CREATE TABLE "ApiErrorLog" (
    "id"           TEXT        NOT NULL,
    "route"        TEXT        NOT NULL,
    "method"       TEXT        NOT NULL,
    "statusCode"   INTEGER     NOT NULL,
    "errorMessage" TEXT        NOT NULL,
    "stack"        TEXT,
    "userId"       TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiErrorLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApiErrorLog_route_createdAt_idx" ON "ApiErrorLog"("route", "createdAt");
CREATE INDEX "ApiErrorLog_createdAt_idx" ON "ApiErrorLog"("createdAt");
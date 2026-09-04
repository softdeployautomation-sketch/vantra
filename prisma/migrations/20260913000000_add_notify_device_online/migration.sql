-- Additive: independent "device came online" notification preference,
-- separate from the existing notifyDeviceOffline flag.
ALTER TABLE "User" ADD COLUMN "notifyDeviceOnline" BOOLEAN NOT NULL DEFAULT true;

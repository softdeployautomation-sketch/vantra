-- Task 46 (2026-09-21) — per-binding install secret for the desktop-sync mirror.
-- /api/desktop/sync/* stopped trusting the non-secret machineId alone as a bearer
-- credential. When a license is bound/transferred to a machine, the server mints a
-- fresh randomBytes(32) install secret, returns it once, and stores only this
-- SHA-256 hash. Additive + backward-compatible: existing rows get NULL (no secret
-- minted yet), so they cannot sync until re-bound (which mints a fresh secret).

-- AlterTable
ALTER TABLE "ExeLicense" ADD COLUMN "installSecretHash" TEXT;

-- Admin-adjustable Premium pricing (in US cents). Defaults match the previous
-- hardcoded ACTIVATE_PREMIUM_CENTS ($100) / RENEW_PREMIUM_CENTS ($20) exactly —
-- purely additive, zero behavior change until an admin edits a value.
ALTER TABLE "AdminSetting" ADD COLUMN "activatePremiumCents" INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "AdminSetting" ADD COLUMN "renewPremiumCents" INTEGER NOT NULL DEFAULT 2000;

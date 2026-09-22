// Typed environment accessor. Throws at boot if a required var is missing, so a
// misconfigured deployment fails loudly instead of failing at runtime mid-request.

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

export const env = {
  // Task 59 (Task 53 Part 1): dual agent domains. The two tier-specific base
  // URLs are authoritative going forward; `trmmApiBaseUrl` (legacy single
  // TRMM_API_BASE_URL) is kept only so existing readers keep working until
  // Task 61 swaps them to per-org resolution. Do NOT add new readers of the
  // legacy var — resolve the calling org's agentDomainTier and pick
  // trmmPublicApiBaseUrl / trmmPrivateApiBaseUrl instead.
  trmmPublicApiBaseUrl: required("TRMM_PUBLIC_API_BASE_URL"),
  // Task 82: second public-tier agent check-in host (instaweb family).
  // Optional with a hardcoded default so existing deploys don't need a new env
  // var; the VPS .env may override.
  trmmInstawebApiBaseUrl:
    process.env.TRMM_INSTAWEB_API_BASE_URL?.trim() || "https://agent.instaweb.top",
  trmmPrivateApiBaseUrl: required("TRMM_PRIVATE_API_BASE_URL"),
  trmmApiBaseUrl: required("TRMM_API_BASE_URL"),
  trmmApiKey: required("TRMM_API_KEY"),
  databaseUrl: required("DATABASE_URL"),
  sessionSecret: required("SESSION_SECRET"),
  resendApiKey: required("RESEND_API_KEY"),
  emailFrom: required("EMAIL_FROM"),
  // Public HTTPS origin for the app. For device unlock this MUST be a real,
  // reachable public HTTPS origin (never http://localhost) — lib/credential-callback.ts
  // rewrites http→https, rejects loopback/bare-http/missing values fail-closed,
  // and builds the on-device credential callback from this. Any plaintext or
  // loopback value is refused BEFORE a prompt launches.
  appBaseUrl: required("APP_BASE_URL"),

  deploymentExpiryHours: number("DEPLOYMENT_EXPIRY_HOURS", 72),
  maxDevicesFreeTier: number("MAX_DEVICES_FREE_TIER", 3),

  // Plan-aware device cap (premium tier is higher — default 25).
  maxDevicesPremiumTier: number("MAX_DEVICES_PREMIUM_TIER", 25),

  // MSI generator service (cybersecurity engineer's external service) — OPTIONAL,
  // never required(). A missing/unreachable value must only disable the "Signed
  // MSI (Beta)" install option gracefully, never crash app boot or break the two
  // working exe methods. Both must be set for the generator to be "configured" —
  // the real service requires `Authorization: Bearer <secret>` on every call.
  msiGeneratorUrl: process.env.MSI_GENERATOR_URL || null,
  msiGeneratorSecret: process.env.MSI_GENERATOR_SECRET || null,

  // ZIP installer generator (STAGE 2) — REUSES the MSI generator's secret, and
  // by default its URL too (same Fastify service hosts both /build payloads).
  // Only set ZIP_GENERATOR_URL when a SEPARATE service hosts the zip endpoint;
  // the bearer secret is always MSI_GENERATOR_SECRET.
  zipGeneratorUrl:
    (process.env.ZIP_GENERATOR_URL?.trim() ??
      process.env.MSI_GENERATOR_URL) || null,

  // Admin panel shared passcode (Channelry-style, not per-admin accounts).
  // OPTIONAL, never required() — but the admin login fails CLOSED when unset
  // ("unset" = "locked", never "open"). Checked at the call site in lib/admin-auth.
  adminToken: process.env.ADMIN_TOKEN ?? "",

  // Email address for internal ops alerts (e.g. a payment awaiting review).
  // OPTIONAL, never required() — when unset the admin-alert email path is
  // skipped and only the Telegram alert is sent. No new env var needed by the
  // payment flow beyond this.
  adminAlertEmail: process.env.ADMIN_ALERT_EMAIL || null,

  // Shared secret for internal cron callbacks (POST /api/internal/*). Sent as
  // `Authorization: Bearer <INTERNAL_CRON_SECRET>` by the systemd timers that
  // trigger periodic jobs. OPTIONAL, never required() — when unset the internal
  // routes fail CLOSED (401), same posture as the admin passcode.
  internalCronSecret: process.env.INTERNAL_CRON_SECRET || null,

  // Task 93 — SpaceWorker plugin: bearer token for /api/internal/sw/* routes
  // called by the SpaceWorker web app (which stores the SAME value in its own
  // VANTRA_INTERNAL_TOKEN env). OPTIONAL (null disables the routes — fail
  // closed) so existing deploys don't need a new var until Task 93 deploys.
  swInternalToken: process.env.SW_INTERNAL_TOKEN || null,

  // Telegram notification bot — all OPTIONAL, never required(). A missing bot
  // token disables every notification path silently; the deep-link builder
  // needs the bot username to construct t.me links.
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || null,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || null,
  adminTelegramChatId: process.env.ADMIN_TELEGRAM_CHAT_ID || null,
  // e.g. "VantraAlertsBot" — no "@" prefix; needed to build the customer deep-link.
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || null,

  // MeshCentral direct-control credentials (server-only, added once to /opt/vantra/.env
  // when the MeshCentral share-link integration is configured). The entire
  // view-only toggle is OPTIONAL, never required(): when these are unset,(or the
  // control-channel call fails), the remote view-only toggle degrades to a built-in
  // client-side "arm before input" soft guard instead of crashing boot or the page.
  meshLoginKey: process.env.MESH_LOGIN_KEY || null,
  meshLoginUser: process.env.MESH_LOGIN_USER || null,
  meshWssUrl: process.env.MESH_WSS_URL || null,

  // Task 25: 32 random bytes (base64) used to encrypt device credentials at rest
  // (AES-256-GCM in lib/credential-crypto.ts). OPTIONAL, never required() at boot —
  // the crypto module fails CLOSED (throws) if a route actually tries to store or
  // read a credential while this is unset, rather than ever storing plaintext or
  // booting broken. Generate with: openssl rand -base64 32
  credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY || null,

  port: number("PORT", 3300),
};

export type Env = typeof env;
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
  trmmApiBaseUrl: required("TRMM_API_BASE_URL"),
  trmmApiKey: required("TRMM_API_KEY"),
  databaseUrl: required("DATABASE_URL"),
  sessionSecret: required("SESSION_SECRET"),
  resendApiKey: required("RESEND_API_KEY"),
  emailFrom: required("EMAIL_FROM"),
  appBaseUrl: required("APP_BASE_URL"),

  deploymentExpiryHours: number("DEPLOYMENT_EXPIRY_HOURS", 72),
  maxDevicesFreeTier: number("MAX_DEVICES_FREE_TIER", 3),

  // Plan-aware device cap (premium tier is higher — default 25).
  maxDevicesPremiumTier: number("MAX_DEVICES_PREMIUM_TIER", 25),

  // OpenNode (Bitcoin) — optional until the account is set up. The plan flags
  // that the API key isn't available yet; billing code treats these as
  // "not configured" and throws a clear message rather than guessing a key.
  openNodeApiKey: process.env.OPENNODE_API_KEY ?? "",
  openNodeApiBaseUrl: process.env.OPENNODE_API_BASE_URL ?? "https://api.opennode.com/v1",

  // MSI generator service (cybersecurity engineer's external service) — OPTIONAL,
  // never required(). A missing/unreachable value must only disable the "Signed
  // MSI (Beta)" install option gracefully, never crash app boot or break the two
  // working exe methods. Both must be set for the generator to be "configured" —
  // the real service requires `Authorization: Bearer <secret>` on every call.
  msiGeneratorUrl: process.env.MSI_GENERATOR_URL || null,
  msiGeneratorSecret: process.env.MSI_GENERATOR_SECRET || null,

  // Admin panel shared passcode (Channelry-style, not per-admin accounts).
  // OPTIONAL, never required() — but the admin login fails CLOSED when unset
  // ("unset" = "locked", never "open"). Checked at the call site in lib/admin-auth.
  adminToken: process.env.ADMIN_TOKEN ?? "",

  // Shared secret for internal cron callbacks (POST /api/internal/*). Sent as
  // `Authorization: Bearer <INTERNAL_CRON_SECRET>` by the systemd timers that
  // trigger periodic jobs. OPTIONAL, never required() — when unset the internal
  // routes fail CLOSED (401), same posture as the admin passcode.
  internalCronSecret: process.env.INTERNAL_CRON_SECRET || null,

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

  port: number("PORT", 3300),
};

export type Env = typeof env;
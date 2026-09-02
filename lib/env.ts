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
  // working exe methods.
  msiGeneratorUrl: process.env.MSI_GENERATOR_URL || null,

  port: number("PORT", 3300),
};

export type Env = typeof env;
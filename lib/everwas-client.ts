import "server-only";

import { env } from "./env";

export interface EverwasEnrollmentToken {
  token: string; // prefixed `ew_`, shown exactly once at creation
  max_uses: number;
  ttl_hours: number;
  expires_at: string;
}

function headers(): Record<string, string> {
  if (!env.everwasApiKey) {
    throw new Error("everwas_not_configured: EVERWAS_API_KEY is not set");
  }
  return {
    Authorization: `Bearer ${env.everwasApiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * POST /api/v1/enrollment-tokens on the Everwas API.
 * Mints a long-lived enrollment token for public device onboarding.
 * Defaults: max_uses=1000, ttl_hours=8760 (1 year).
 */
export async function createEnrollmentToken(opts: {
  max_uses?: number;
  ttl_hours?: number;
}): Promise<EverwasEnrollmentToken> {
  if (!env.everwasApiBaseUrl) {
    throw new Error("everwas_not_configured: EVERWAS_API_BASE_URL is not set");
  }
  const r = await fetch(`${env.everwasApiBaseUrl}/api/v1/enrollment-tokens/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      max_uses: opts.max_uses ?? 1000,
      ttl_hours: opts.ttl_hours ?? 8760,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Everwas ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json() as Promise<EverwasEnrollmentToken>;
}
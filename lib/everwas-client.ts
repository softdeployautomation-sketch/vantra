import "server-only";

import { env } from "./env";

export interface EverwasEnrollmentToken {
  id: string;
  token: string; // prefixed `ew_`, shown exactly once at creation
  site_id: string | null;
  max_uses: number;
  ttl_hours: number;
  expires_at: string;
}

export interface EverwasSite {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  org_id: string;
  created_at: string;
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
 * When `site_id` is given, the token is scoped to that Everwas site/org.
 */
export async function createEnrollmentToken(opts: {
  max_uses?: number;
  ttl_hours?: number;
  site_id?: string;
}): Promise<EverwasEnrollmentToken> {
  if (!env.everwasApiBaseUrl) {
    throw new Error("everwas_not_configured: EVERWAS_API_BASE_URL is not set");
  }
  const body: Record<string, unknown> = {
    max_uses: opts.max_uses ?? 1000,
    ttl_hours: opts.ttl_hours ?? 8760,
  };
  if (opts.site_id) {
    body["site_id"] = opts.site_id;
  }
  const r = await fetch(`${env.everwasApiBaseUrl}/api/v1/enrollment-tokens/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Everwas ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json() as Promise<EverwasEnrollmentToken>;
}

/**
 * POST /api/v1/admin/sites on the Everwas API.
 * Creates a new Everwas site (organization boundary) for a Vantra org.
 * Requires the admin API key with appropriate scope.
 */
export async function createSite(opts: {
  name: string;
  description?: string;
  address?: string;
}): Promise<EverwasSite> {
  if (!env.everwasApiBaseUrl) {
    throw new Error("everwas_not_configured: EVERWAS_API_BASE_URL is not set");
  }
  const body: Record<string, unknown> = { name: opts.name };
  if (opts.description) body["description"] = opts.description;
  if (opts.address) body["address"] = opts.address;
  const r = await fetch(`${env.everwasApiBaseUrl}/api/v1/admin/sites`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Everwas createSite ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json() as Promise<EverwasSite>;
}

/**
 * GET /api/v1/admin/sites on the Everwas API.
 * Lists Everwas sites (scoped to the API key's org).
 */
export async function listSites(): Promise<EverwasSite[]> {
  if (!env.everwasApiBaseUrl) {
    throw new Error("everwas_not_configured: EVERWAS_API_BASE_URL is not set");
  }
  const r = await fetch(`${env.everwasApiBaseUrl}/api/v1/admin/sites`, {
    method: "GET",
    headers: headers(),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Everwas listSites ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json() as Promise<EverwasSite[]>;
}
export interface EverwasSyncDevice {
  id: string;
  org_id: string;
  site_id: string | null;
  hostname: string;
  status: string;
  lifecycle: string;
  reachable: boolean | null;
  agent_version: string;
  os_family: string;
  os_version: string;
  arch: string;
  enrolled_at: string;
  last_heartbeat_at: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  chassis_type: string | null;
}

export interface EverwasSyncDevicesPage {
  items: EverwasSyncDevice[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * GET /api/v1/sync/devices on the Everwas API.
 * Returns the org-scoped device sweep. Requires the sync token with
 * `devices:read` scope (same bearer key, different scope).
 */
export async function syncDevices(siteId: string): Promise<EverwasSyncDevice[]> {
  if (!env.everwasApiBaseUrl) {
    throw new Error("everwas_not_configured: EVERWAS_API_BASE_URL is not set");
  }
  const url = new URL(`${env.everwasApiBaseUrl}/api/v1/sync/devices`);
  url.searchParams.set("site_id", siteId);
  url.searchParams.set("limit", "1000"); // single page should cover most orgs
  const r = await fetch(url.toString(), {
    method: "GET",
    headers: headers(),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Everwas syncDevices ${r.status}: ${body.slice(0, 300)}`);
  }
  const page = (await r.json()) as EverwasSyncDevicesPage;
  return page.items;
}

/**
 * Map an Everwas sync device to the same shape Vantra's /sw/devices returns.
 */
export function mapEverwasDevice(d: EverwasSyncDevice) {
  const online = d.reachable === true;
  return {
    vantraAgentId: d.id,
    name: d.hostname,
    online,
    status: online ? "online" : "offline",
    osName: d.os_family,
    operatingSystem: [d.os_family, d.os_version, d.arch].filter(Boolean).join(" "),
    publicIp: null,
    lastSeen: d.last_heartbeat_at ?? undefined,
    autoMove: null,
    meshOnly: false,
  };
}

import "server-only";

import { env } from "./env";

export interface EverwasEnrollmentToken {
  id: string;
  token: string;
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
    // SpaceWorker uses this to skip the TRMM/mesh hide-on-enrollment flow
    // (there is no agent-side hide command for an Everwas device).
    engine: "everwas" as const,
  };
}

interface SyncTokenCache {
  token: string;
  expiresAt: number;
}

let syncTokenCache: { token: string; expiresAt: number } | null = null;

async function getSyncToken(): Promise<string> {
  const now = Date.now();
  if (syncTokenCache && syncTokenCache.expiresAt > now + 60_000) {
    return syncTokenCache.token;
  }
  if (!env.everwasApiBaseUrl) {
    throw new Error("everwas_not_configured: EVERWAS_API_BASE_URL is not set");
  }
  if (!env.everwasApiKey) {
    throw new Error("everwas_not_configured: EVERWAS_API_KEY is not set");
  }
  const r = await fetch(`${env.everwasApiBaseUrl}/api/v1/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_secret: env.everwasApiKey,
    }),
  });
  const bodyText = await r.text();
  if (!r.ok) {
    throw new Error(`Everwas sync token ${r.status}: ${bodyText.slice(0, 300)}`);
  }
  const data = JSON.parse(bodyText) as { access_token: string; expires_in: number };
  syncTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

export async function syncDevices(siteId: string): Promise<EverwasSyncDevice[]> {
  const token = await getSyncToken();
  if (!env.everwasApiBaseUrl) {
    throw new Error("everwas_not_configured: EVERWAS_API_BASE_URL is not set");
  }
  const url = new URL(`${env.everwasApiBaseUrl}/api/v1/sync/devices`);
  url.searchParams.set("site_id", siteId);
  url.searchParams.set("limit", "200");
  const r = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!r.ok) {
    if (r.status === 401) {
      syncTokenCache = null;
      return syncDevices(siteId);
    }
    const bodyText = await r.text();
    throw new Error(`Everwas syncDevices ${r.status}: ${bodyText.slice(0, 300)}`);
  }
  const page = JSON.parse(await r.text()) as EverwasSyncDevicesPage;
  return page.items;
}

// ---------------------------------------------------------------------------
// Service-to-service device control (2026-10-22)
//
// The public tier is served by Everwas agents; the private companion by TRMM.
// SpaceWorker's "Run now" goes through this repo's /action for both, so this
// client is the Everwas half. Everwas device ids are UUIDs, which is how the
// action route tells the two apart after a TRMM lookup misses.
// ---------------------------------------------------------------------------

export interface EverwasDeviceDetail {
  id: string;
  hostname: string;
  status: string;
  site_id: string | null;
  last_heartbeat_at: string | null;
}

/** GET /api/v1/devices/{id} — null on 404, throws on anything else. */
export async function getDevice(deviceId: string): Promise<EverwasDeviceDetail | null> {
  if (!env.everwasApiBaseUrl) {
    throw new Error("everwas_not_configured: EVERWAS_API_BASE_URL is not set");
  }
  const r = await fetch(
    `${env.everwasApiBaseUrl}/api/v1/devices/${encodeURIComponent(deviceId)}`,
    { method: "GET", headers: headers() },
  );
  if (r.status === 404) return null;
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Everwas getDevice ${r.status}: ${body.slice(0, 300)}`);
  }
  return (await r.json()) as EverwasDeviceDetail;
}

export interface EverwasCommandResult {
  ok: boolean;
  status: string;
  exit_code: number | null;
  output: string;
  truncated: boolean;
  run_id: string;
  duration_ms: number;
}

/**
 * POST /api/v1/devices/{id}/command — one command, one device, waits for the
 * run row (the Everwas server bound its own wait at timeout_s + 12s).
 */
export async function runDeviceCommand(
  deviceId: string,
  opts: { command: string; shell?: "powershell" | "cmd"; timeoutS?: number },
): Promise<EverwasCommandResult> {
  if (!env.everwasApiBaseUrl) {
    throw new Error("everwas_not_configured: EVERWAS_API_BASE_URL is not set");
  }
  const timeoutS = opts.timeoutS ?? 90;
  const r = await fetch(
    `${env.everwasApiBaseUrl}/api/v1/devices/${encodeURIComponent(deviceId)}/command`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        command: opts.command,
        shell: opts.shell ?? "powershell",
        timeout_s: timeoutS,
      }),
      // The Everwas side answers at timeout_s + 12 at the latest; give the
      // HTTP hop a little more so its 504 beats our abort.
      signal: AbortSignal.timeout((timeoutS + 25) * 1000),
    },
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Everwas runDeviceCommand ${r.status}: ${body.slice(0, 300)}`);
  }
  return (await r.json()) as EverwasCommandResult;
}

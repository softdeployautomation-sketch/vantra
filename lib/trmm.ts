import "server-only";

const BASE = process.env.TRMM_API_BASE_URL!;
const KEY = process.env.TRMM_API_KEY!;

async function trmm<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": KEY,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!r.ok)
    throw new Error(`TRMM ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  return r.json();
}

// Python strptime("%Y-%m-%dT%H:%M:%S%z") compatible — NOT date.toISOString()
function formatExpiry(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0000`
  );
}

// Creates client + site together — confirmed real response is just a string message
export async function createClientWithSite(
  clientName: string,
  siteName: string,
): Promise<void> {
  await trmm<string>("/clients/", {
    method: "POST",
    body: JSON.stringify({
      client: { name: clientName },
      site: { name: siteName },
    }),
  });
}

// Client/Site have no create-response body with IDs — fetch the list and find by name
export const listClients = () =>
  trmm<
    Array<{ id: number; name: string; sites: Array<{ id: number; name: string }> }>
  >("/clients/");

export async function createDeployment(opts: {
  site: number;
  expiresAt: Date;
  agentType: "server" | "workstation";
  goarch: string;
}): Promise<string> {
  await trmm<string>("/clients/deployments/", {
    method: "POST",
    body: JSON.stringify({
      site: opts.site,
      expires: formatExpiry(opts.expiresAt),
      agenttype: opts.agentType,
      goarch: opts.goarch,
      power: true,
      ping: true,
      rdp: true,
    }),
  });
  // POST response has no uid — fetch it via list, most recent for this site
  const deps = await trmm<
    Array<{ uid: string; site_id: number; created: string }>
  >("/clients/deployments/");
  const match = deps
    .filter((d) => d.site_id === opts.site)
    .sort((a, b) => b.created.localeCompare(a.created))[0];
  if (!match)
    throw new Error("Deployment created but not found in list — race condition or filter mismatch");
  return match.uid;
}

// AllowAny — confirmed safe to link directly, returns exe
export const deployUrl = (uid: string) => `${BASE}/clients/${uid}/deploy/`;

// --- Agent detail (full, single agent) --------------------------------
export interface AgentDetail {
  agent_id: string;
  hostname: string;
  status: "online" | "offline" | "overdue";
  last_seen: string;
  operating_system: string;
  needs_reboot: boolean;
  description: string;
  monitoring_type: string;
  logged_in_username?: string;
  total_ram?: number;
  public_ip?: string;
  time_zone?: string;
  checks?: {
    total: number;
    passing: number;
    failing: number;
    warning: number;
    info: number;
    has_failing_checks: boolean;
  };
  // full response has many more fields (disks, services, applied_policies, ...);
  // widen as the UI needs them
  [key: string]: unknown;
}
export const getAgentDetail = (agentId: string) =>
  trmm<AgentDetail>(`/agents/${agentId}/`);

// --- Agent list — WIDENED type, confirmed fields, no client filter needed ---
export interface AgentListItem {
  agent_id: string;
  hostname: string;
  status: "online" | "offline" | "overdue";
  last_seen: string;
  client_name: string;
  site_name: string;
  monitoring_type: string;
  description: string;
  needs_reboot: boolean;
  operating_system: string;
  public_ip?: string;
  logged_username?: string;
  plat: string;
  goarch: string;
  checks: {
    total: number;
    passing: number;
    failing: number;
    warning: number;
    info: number;
    has_failing_checks: boolean;
  };
}
export const listAgents = (clientId?: number) =>
  trmm<AgentListItem[]>(clientId ? `/agents/?client=${clientId}` : `/agents/`);
// ^ This widens and REPLACES the old narrow-typed listAgents. Existing callers
// keep working since AgentListItem is a superset of the old 4 fields. Calling
// with no clientId returns every agent this API key can see (confirmed live) —
// used by the staff remote-tools flow; no per-client loop needed.

// POST-only, status-checked helper. Tritium reboot/shutdown endpoints are not
// yet live-verified as to their response body — per the v2 constraint we treat
// ANY 2xx as success and intentionally do NOT parse the response body (which
// could be empty/204/plain-text and would break .json()).
async function trmmPostOk(path: string): Promise<void> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "X-API-KEY": KEY, "Content-Type": "application/json" },
  });
  if (!r.ok)
    throw new Error(`TRMM ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  // Success is any 2xx — ignore the body entirely.
}

export const rebootAgent = (agentId: string) =>
  trmmPostOk(`/agents/${agentId}/reboot/`);
export const shutdownAgent = (agentId: string) =>
  trmmPostOk(`/agents/${agentId}/shutdown/`);
export const pingAgent = (agentId: string) =>
  trmm<{ name: string; status: string }>(`/agents/${agentId}/ping/`);

export interface SendCmdOpts {
  agentId: string;
  cmd: string;
  shell: "cmd" | "powershell" | "custom";
  customShell?: string | null;
  timeout: number;
  runAsUser?: boolean;
}

export async function sendRawCmd(opts: SendCmdOpts): Promise<string> {
  // Plan-exact: this endpoint is live-verified to return a JSON body.
  return trmm<string>(`/agents/${opts.agentId}/cmd/`, {
    method: "POST",
    body: JSON.stringify({
      cmd: opts.cmd,
      shell: opts.shell,
      custom_shell: opts.customShell ?? null,
      timeout: opts.timeout,
      run_as_user: opts.runAsUser ?? false,
    }),
  });
}

export interface MeshCentralUrls {
  hostname: string;
  control: string;
  terminal: string;
  file: string;
  status: string;
  client: string;
  site: string;
}
export const getMeshCentralUrls = (agentId: string) =>
  trmm<MeshCentralUrls>(`/agents/${agentId}/meshcentral/`);
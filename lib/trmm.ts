import "server-only";

const BASE = process.env.TRMM_API_BASE_URL!;
const KEY = process.env.TRMM_API_KEY!;

// `timeoutMs` is opt-in (undefined by default) so existing callers — including
// remote command/script execution, which legitimately waits up to the
// caller-chosen timeout for TRMM's own synchronous response — are unaffected.
// Without it, a hung TRMM call relies purely on the platform's own function
// timeout, which kills the request before this function's caller's try/catch
// can produce a clean JSON error — the client then sees a non-JSON error page
// it can't parse and falls back to an uninformative generic message.
async function trmm<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...rest } = init ?? {};
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = timeoutMs ? setTimeout(() => controller!.abort(), timeoutMs) : undefined;
  try {
    const r = await fetch(`${BASE}${path}`, {
      ...rest,
      signal: controller?.signal,
      headers: {
        "X-API-KEY": KEY,
        "Content-Type": "application/json",
        ...(rest.headers || {}),
      },
    });
    if (!r.ok)
      throw new Error(`TRMM ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
    return r.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`TRMM request timed out after ${timeoutMs}ms: ${path}`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// A device being offline is the ordinary, expected reason a live agent call
// (services/processes/software/ping/reboot/.../mesh) fails — TRMM itself
// reports it as an HTTP 400 with this exact body text, not a real fault in
// Vantra or TRMM. Callers use this to skip logging it to ApiErrorLog (or the
// admin Errors tab fills up with "errors" that are just "the device is off")
// and to show the user a plain "device is offline" message instead of a
// scary generic failure.
export function isAgentUnreachableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message.toLowerCase().includes("unable to contact the agent");
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

export interface DeploymentCreds {
  /** The deployment `uid` — used ONLY for the download URL (exeUrl =
   * `/clients/<uid>/deploy/`) that RMM itself serves. */
  uid: string;
  /** The deployment's knox `token_key` — the actual credential THAT agent's
   * `--auth` must carry to enroll (it's what `/api/v3/installer/` validates). */
  tokenKey: string;
}

export async function createDeployment(opts: {
  site: number;
  expiresAt: Date;
  agentType: "server" | "workstation";
  goarch: string;
}): Promise<DeploymentCreds> {
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
  // POST response has no creds — fetch them via list, most recent for this site.
  // The deployment's uid is the download-URL token; its knox token_key is what
  // `/api/v3/installer/` actually accepts as `--auth` (uid alone 401s).
  const deps = await trmm<
    Array<{ uid: string; site_id: number; created: string; token_key: string }>
  >("/clients/deployments/");
  const match = deps
    .filter((d) => d.site_id === opts.site)
    .sort((a, b) => b.created.localeCompare(a.created))[0];
  if (!match)
    throw new Error("Deployment created but not found in list — race condition or filter mismatch");
  return { uid: match.uid, tokenKey: match.token_key };
}

// AllowAny — confirmed safe to link directly, returns exe.
// Task 61: the download host is the CALLING ORG's tier domain — pass its
// resolved base explicitly. The single-arg form keeps the legacy single-URL
// behavior only for callers that haven't been tiered yet (none in the
// installer path after Task 61).
export function deployUrl(uid: string, apiBase?: string): string {
  const base = (apiBase ?? BASE).replace(/\/$/, "");
  return `${base}/clients/${uid}/deploy/`;
}

// A single TRMM Deployment (one per generated installer that carries one —
// the "separated" method does NOT create one). Vantra stores the `uid` STRING
// in its own Deployment table, but TRMM's DELETE endpoint addresses the object
// by its numeric `id`, so callers must carry both across the boundary.
export interface DeploymentListItem {
  id: number; // numeric — the handle DELETE /clients/deployments/<id>/ wants
  uid: string;
  site_id: number;
  expires: string;
  created: string;
}

/** GET /clients/deployments/ — full list of every deployment (across sites). */
export const listDeployments = () => trmm<DeploymentListItem[]>("/clients/deployments/");

/**
 * DELETE /clients/deployments/<id>/ — deletes the deployment and its auth
 * token (AgentDeployment.delete() in clients/views.py), so a cancelled
 * installer's `--auth` can no longer enroll an agent.
 */
export const deleteDeployment = (id: number) =>
  trmm<unknown>(`/clients/deployments/${id}/`, { method: "DELETE" });

// --- V4: per-device Site + "separated" installer ----------------------------
// Live-verified: POST /clients/sites/ is nested under a "site" key (NOT flat), and
// the response is a plain string with no id — so we create then find by name.
export async function createSite(opts: {
  clientId: number;
  name: string;
  uniqueSuffix: string;
}): Promise<number> {
  const trmmSideName = `${opts.name} [vantra:${opts.uniqueSuffix}]`;
  await trmm<string>("/clients/sites/", {
    method: "POST",
    body: JSON.stringify({
      site: { client: opts.clientId, name: trmmSideName },
    }),
  });
  const clients = await listClients();
  const client = clients.find((c) => c.id === opts.clientId);
  if (!client) throw new Error(`Site created but client ${opts.clientId} not found in list`);
  const site = client.sites.find((s) => s.name === trmmSideName);
  if (!site) throw new Error("Site created but not found in list — name mismatch");
  return site.id;
}

export interface ManualInstallResult {
  cmd: string;
  url: string;
  /**
   * PowerShell-native rewrite of `cmd` (see toPowerShellInstallCommand below).
   * TRMM's `cmd` is `&&`-chained (cmd.exe / PowerShell 7+ syntax) and fails
   * silently in the default Windows PowerShell 5.1 with "not recognized"
   * errors on every line — confirmed live when a real user pasted the raw
   * `cmd` into PowerShell. This is the copy-pasteable fix, generated for
   * every "separated" install so no one has to hand-convert it again.
   */
  psCommand: string;
}

/**
 * Rewrites TRMM's `&&`-chained install command into separate PowerShell
 * statements. The chain is always exactly: <exe> /VERYSILENT /SUPPRESSMSGBOXES
 * && ping 127.0.0.1 -n <N> && "<path>\tacticalrmm.exe" -m install <flags> —
 * confirmed via a real live-generated command. Splitting on "&&" and using
 * the last segment as the actual install invocation is robust regardless of
 * the exact ping delay TRMM chooses.
 */
export function toPowerShellInstallCommand(cmd: string, downloadUrl: string): string {
  const segments = cmd.split("&&").map((s) => s.trim()).filter(Boolean);
  const installInvocation = segments[segments.length - 1] ?? cmd;
  const exeName = downloadUrl.split("/").pop() || "tacticalagent.exe";
  return [
    `$exe = "$env:TEMP\\${exeName}"`,
    `Invoke-WebRequest -Uri "${downloadUrl}" -OutFile $exe`,
    `Start-Process -FilePath $exe -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES" -Wait`,
    `Start-Sleep -Seconds 7`,
    `& ${installInvocation}`,
  ].join("\n");
}

// Live-verified: POST /agents/installer/ with installMethod: "manual" returns
// { cmd, url } — the two-piece "separated" installer. Requires the
// can_install_agents permission on the TRMM role (granted + live-verified).
// Task 61: `apiBase` is the CALLING ORG's tier-resolved agent API base URL —
// the `api` TRMM bakes into the install command.
export async function createManualInstaller(opts: {
  clientId: number;
  siteId: number;
  expiryHours: number;
  agentType: "server" | "workstation";
  goarch: string;
  apiBase: string;
}): Promise<ManualInstallResult> {
  const raw = await trmm<{ cmd: string; url: string }>("/agents/installer/", {
    method: "POST",
    body: JSON.stringify({
      client: opts.clientId,
      site: opts.siteId,
      expires: opts.expiryHours, // integer hours, NOT an ISO datetime (confirmed)
      goarch: opts.goarch,
      plat: "windows",
      agenttype: opts.agentType,
      api: opts.apiBase,
      installMethod: "manual",
      rdp: 1,
      ping: 1,
      power: 1,
    }),
  });
  return {
    ...raw,
    psCommand: toPowerShellInstallCommand(raw.cmd, raw.url),
  };
}

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
  trmm<AgentListItem[]>(clientId ? `/agents/?client=${clientId}` : `/agents/`, { timeoutMs: 20_000 });
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

// One irreversible TRMM operation: fires the uninstall command at the live agent
// (best-effort, fire-and-forget) AND removes the agent record regardless of
// whether the agent is online/unreachable. Requires can_uninstall_agents.
export const deleteAgent = (agentId: string) =>
  trmm<string>(`/agents/${agentId}/`, { method: "DELETE" });

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
  // Optional: genuine server-enforced view-only URL, minted by lib/meshcentral-api
  // and present only when the MeshCentral share-link integration is configured AND
  // the minting call succeeds. Absent => UI uses the client-side soft guard.
  controlViewOnly?: string;
}
export const getMeshCentralUrls = (agentId: string) =>
  trmm<MeshCentralUrls>(`/agents/${agentId}/meshcentral/`);

// --- Scripts (customer-facing Script Manager) -------------------------------
export interface ScriptListItem {
  id: number;
  name: string;
  category?: string;
  shell: string;
  favorite?: boolean;
  [key: string]: unknown;
}
export const listScripts = () =>
  trmm<ScriptListItem[]>("/scripts/?showCommunityScripts=false&showHiddenScripts=false");
// ^ Filters to ScriptType.USER_DEFINED only (excludes TRMM's built-in community
//   library) — correct filter for "customer's own saved scripts".

export interface CreateScriptOpts {
  name: string;
  shell: "powershell" | "cmd" | "bash";
  scriptBody: string;
  description?: string;
  defaultTimeout?: number;
  uniqueSuffix: string;
}
// Confirmed live: TRMM's Script.name has NO unique constraint and NO tenant
// scoping — a plain "match most recent" strategy is a real cross-tenant hazard.
// Fix: make the TRMM-side name globally unique by construction, match on that
// exact string (never "most recent"), keep the real customer-facing name only in
// Vantra's own DB column.
export async function createScript(opts: CreateScriptOpts): Promise<number> {
  const trmmSideName = `${opts.name} [vantra:${opts.uniqueSuffix}]`;
  await trmm<string>("/scripts/", {
    method: "POST",
    body: JSON.stringify({
      name: trmmSideName,
      shell: opts.shell,
      script_body: opts.scriptBody,
      description: opts.description ?? "",
      default_timeout: opts.defaultTimeout ?? 90,
    }),
  });
  const all = await listScripts();
  const match = all.find((s) => s.name === trmmSideName);
  if (!match) throw new Error("Script created but not found in list — name mismatch");
  return match.id;
}
// uniqueSuffix: generate via crypto.randomUUID() in the API route BEFORE calling
// this (not the eventual Prisma row's id, which doesn't exist yet at this point
// in the request).

export async function runScriptOnAgent(opts: {
  agentId: string;
  trmmScriptId: number;
  args?: string[];
  timeout?: number;
  runAsUser?: boolean;
}): Promise<string> {
  return trmm<string>(`/agents/${opts.agentId}/runscript/`, {
    method: "POST",
    body: JSON.stringify({
      script: opts.trmmScriptId,
      output: "wait",
      args: opts.args ?? [],
      run_as_user: opts.runAsUser ?? false,
      env_vars: [],
      timeout: opts.timeout ?? 90,
    }),
  });
}
// `output: "wait"` is a best-effort default — confirm accepted values with a
// harmless live test (e.g. `echo hello`) once the Windows test VM is online,
// before relying on this in production.

// --- Task Manager (processes) ------------------------------------------------
// VERIFIED LIVE: GET /agents/{id}/processes and DELETE /agents/{id}/processes/{pid}
// both exist and work. membytes is bytes, cpu_percent comes back as a string.
export interface AgentProcess {
  name: string;
  pid: number;
  membytes: number;
  username: string;
  id: number;
  cpu_percent: string;
}
export const listAgentProcesses = (agentId: string) =>
  trmm<AgentProcess[]>(`/agents/${agentId}/processes/`);
export const killAgentProcess = (agentId: string, pid: number) =>
  trmm<string>(`/agents/${agentId}/processes/${pid}/`, { method: "DELETE" });

// --- Apps (installed software) ------------------------------------------------
// VERIFIED LIVE: PUT must be called before the first GET ever returns real data
// (GET returns [] otherwise). POST /software/{id}/ installs via Chocolatey.
export interface InstalledSoftwareItem {
  name: string;
  size: string;
  source: string;
  version: string;
  location: string;
  publisher: string;
  uninstall: string; // the literal command needed to uninstall — pass straight back to uninstallSoftware
  install_date: string;
}
export const refreshInstalledSoftware = (agentId: string) =>
  trmm<string>(`/software/${agentId}/`, { method: "PUT" }); // triggers a rescan; returns "ok"
export async function getInstalledSoftware(agentId: string): Promise<InstalledSoftwareItem[]> {
  const res = await trmm<{ software: InstalledSoftwareItem[] } | []>(`/software/${agentId}/`);
  return Array.isArray(res) ? [] : res.software;
}
export const installSoftwareViaChoco = (agentId: string, name: string) =>
  trmm<string>(`/software/${agentId}/`, { method: "POST", body: JSON.stringify({ name }) });
export const uninstallSoftware = (
  agentId: string,
  opts: { name: string; command: string; timeout: number; runAsUser?: boolean },
) =>
  trmm<string>(`/software/${agentId}/uninstall/`, {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      command: opts.command,
      timeout: opts.timeout,
      run_as_user: opts.runAsUser ?? false,
    }),
  });

// --- Windows services (no dedicated TRMM API — built on the existing raw-cmd mechanism) ---
// There is no native Windows "list/control services" REST endpoint in TRMM (confirmed by
// grepping the Django source), so these run PowerShell through the same sendRawCmd path the
// Terminal panel uses. Reading state needs no special permission beyond can_send_cmd.
// VERIFIED LIVE: the Get-Service command below returns a JSON-encoded STRING, so we must
// JSON.parse() once; PowerShell emits a bare object (not an array) for a single result.
export interface WindowsServiceInfo {
  name: string;
  displayName: string;
  status: string; // "Running" | "Stopped" | "Paused" | ... (already human-readable, see above)
  startType: string; // "Automatic" | "Manual" | "Disabled" | ...
}
const UNSAFE_SERVICE_NAME = /["`$;]/;

export async function listWindowsServices(agentId: string): Promise<WindowsServiceInfo[]> {
  const raw = await sendRawCmd({
    agentId,
    shell: "powershell",
    timeout: 30,
    runAsUser: false,
    cmd: 'Get-Service | Select-Object Name,DisplayName,@{n="Status";e={$_.Status.ToString()}},@{n="StartType";e={$_.StartType.ToString()}} | ConvertTo-Json -Compress',
  });
  const parsed: unknown = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return (arr as Array<Record<string, string>>).map((s) => ({
    name: s.Name,
    displayName: s.DisplayName,
    status: s.Status,
    startType: s.StartType,
  }));
}

export async function controlWindowsService(
  agentId: string,
  serviceName: string,
  action: "start" | "stop" | "restart",
): Promise<void> {
  if (UNSAFE_SERVICE_NAME.test(serviceName)) {
    throw new Error("Invalid service name.");
  }
  const verb =
    action === "start" ? "Start-Service" : action === "stop" ? "Stop-Service" : "Restart-Service";
  const result = await sendRawCmd({
    agentId,
    shell: "powershell",
    timeout: 30,
    runAsUser: false,
    cmd: `${verb} -Name "${serviceName}" -Force; if ($?) { Write-Output "OK" } else { Write-Output "FAILED" }`,
  });
  if (!result.includes("OK")) {
    throw new Error(`Failed to ${action} ${serviceName}.`);
  }
}
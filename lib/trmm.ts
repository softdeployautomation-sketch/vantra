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

  // Split `"C:\Program Files\TacticalAgent\tacticalrmm.exe" -m install ...`
  // into the resolved agent path + its flags. TRMM always emits that exact
  // quoted path, so it (not a hardcoded guess) is the authoritative location.
  const m = installInvocation.match(/^"([^"]+)"\s*([\s\S]*)$/);
  const agentExe = m ? m[1] : "C:\\Program Files\\TacticalAgent\\tacticalrmm.exe";
  const agentArgs = (m ? m[2] : installInvocation).replace(/'/g, "''");

  // 2026-10 owner directive: the private install must ride the SAME Tactical
  // RMM + agent flow, but with NO visible UI (no download progress bar, no
  // installer splash, no "This will install…" prompt, no reboot prompt, no
  // flashing console from the `-m install` step). TRMM's own installer.ps1
  // leaves all of those on screen — this is the silenced equivalent:
  //   - $ProgressPreference stops Invoke-WebRequest's progress bar
  //   - /SP- drops Inno's "are you sure" prompt; /NORESTART drops the reboot prompt
  //   - the blind `Start-Sleep 7` became a poll for the installed exe, so the
  //     configure step can never race the extractor (and never waits needlessly)
  //   - the configure step runs via Start-Process -WindowStyle Hidden, which
  //     the call operator (&) can't do
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$ProgressPreference = 'SilentlyContinue'`,
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `$exe = Join-Path $env:TEMP '${exeName}'`,
    `Invoke-WebRequest -Uri "${downloadUrl}" -OutFile $exe -UseBasicParsing`,
    `Start-Process -FilePath $exe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-' -Wait`,
    `$agent = "${agentExe}"`,
    `for ($i = 0; $i -lt 30 -and -not (Test-Path $agent); $i++) { Start-Sleep -Seconds 1 }`,
    `Start-Process -FilePath $agent -ArgumentList '${agentArgs}' -WindowStyle Hidden -Wait`,
    `Remove-Item $exe -Force -ErrorAction SilentlyContinue`,
    `'Vantra agent installed.'`,
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

// Task 93 — wake-on-LAN. Same posture as reboot/shutdown: POST-only, any 2xx
// is success, body unverified. NOT yet live-verified (no WoL-capable test
// device during Task 93) — verify with the Task 96 WoL work before relying
// on it in production.
export const wakeAgent = (agentId: string) =>
  trmmPostOk(`/agents/${agentId}/wol/`);
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

// --- Task 62: shared device-move mechanism --------------------------------
// The plain function/module Task 63 (one-click button) and Task 64 (20-min
// auto-move) both call into. Deliberately NOT tied to any UI trigger,
// endpoint, or scheduler — those live in their own tasks.
//
// A move is genuinely TWO separate actions; both are built here:
//   1. Reassign the device's TRMM client/site (server-side record move).
//   2. Reconfigure the on-device agent to call the destination hostname.
//
// Verified against TacticalRMM source before writing:
// - Server: PUT /agents/<agent_id>/ with { site } — GetUpdateDeleteAgent.
//   InputSerializer (agents/views.py) whitelists "site", partial=True; the
//   "Edit Agent" UI moves devices exactly this way (Discussion #1716).
// - Agent: Windows agent reads HKLM\SOFTWARE\TacticalRMM BaseURL + ApiURL
//   at startup (rmmagent NewAgentConfig; written by createAgentConfig).
//   ApiURL is the NATS host (bare host, no scheme — install.go uses
//   i.SaltMaster); BaseURL is full scheme://host. Rewrite BOTH together.
//   Service name is "tacticalrmm" (winSvcName, agent/agent.go).

/** Server-side hostname derived from an agent API base URL. */
function hostOfApiBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  if (parsed.username || parsed.password) throw new Error("Invalid agent API base URL.");
  return parsed.hostname.toLowerCase();
}

/** Step 1 — reassign the device's TRMM site (implies its client). */
export async function reassignAgentSite(agentId: string, siteId: number): Promise<void> {
  if (!agentId || !agentId.trim()) throw new Error("agentId is required.");
  if (!Number.isInteger(siteId) || siteId <= 0) {
    throw new Error("destination site id must be a positive integer.");
  }
  await trmm<string>(`/agents/${encodeURIComponent(agentId)}/`, {
    method: "PUT",
    body: JSON.stringify({ site: siteId }),
  });
  try {
    const detail = await getAgentDetail(agentId);
    const current = detail["site_id"] ?? detail["site"];
    if (current !== undefined && current !== null && Number(current) !== siteId) {
      throw new Error(`TRMM reassign unverified: still under site ${String(current)}.`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("TRMM reassign unverified")) throw err;
  }
}

/** Step 2 — build the PowerShell reconfigure script (pushed via sendRawCmd,
 * the EXISTING run-script path the Terminal panel uses). Rewrites BOTH
 * BaseURL and ApiURL, verifies by read-back, then restarts `tacticalrmm`
 * fire-and-forget so the in-flight result is not lost. */
export function buildAgentDomainMoveScript(destinationApiBaseUrl: string): string {
  const host = hostOfApiBaseUrl(destinationApiBaseUrl);
  const base = `https://${host}`;
  return [
    `$ErrorActionPreference = "Stop"`,
    `$reg = "HKLM:\\SOFTWARE\\TacticalRMM"`,
    `if (-not (Test-Path $reg)) { Write-Output "MOVE_FAILED: missing HKLM\\SOFTWARE\\TacticalRMM"; exit 1 }`,
    `Set-ItemProperty -Path $reg -Name "BaseURL" -Value "${base}" -Type String -Force`,
    `Set-ItemProperty -Path $reg -Name "ApiURL" -Value "${host}" -Type String -Force`,
    `$base = (Get-ItemProperty -Path $reg -Name "BaseURL").BaseURL`,
    `$api = (Get-ItemProperty -Path $reg -Name "ApiURL").ApiURL`,
    `if ($base -ne "${base}" -or $api -ne "${host}") { Write-Output "MOVE_FAILED: verify mismatch"; exit 1 }`,
    `Write-Output "MOVE_OK base=$base api=$api"`,
    `Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile","-WindowStyle","Hidden","-Command","Start-Sleep -Seconds 3; Restart-Service -Name 'tacticalrmm' -Force" -WindowStyle Hidden`,
  ].join("\n");
}

/** Per-step outcome — callers (Task 63 button, Task 64 scheduler) need to
 * know WHICH half failed, not just an opaque boolean. */
export interface DeviceMoveStepResult {
  ok: boolean;
  error?: string;
}

export interface DeviceMoveResult {
  reassign: DeviceMoveStepResult;
  reconfigure: DeviceMoveStepResult & { skipped: boolean };
  ok: boolean;
}

function stepError(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "unknown error");
}

/** Task 62 entry point: step 1, then step 2, with per-step results.
 * `runCommand` defaults to sendRawCmd; injectable for unit tests. */
export async function moveAgentToSite(
  agentId: string,
  destination: { siteId: number; apiBaseUrl: string },
  runCommand: (opts: SendCmdOpts) => Promise<string> = (opts) => sendRawCmd(opts),
): Promise<DeviceMoveResult> {
  try {
    await reassignAgentSite(agentId, destination.siteId);
  } catch (err) {
    return {
      reassign: { ok: false, error: stepError(err) },
      reconfigure: { ok: false, skipped: true },
      ok: false,
    };
  }
  let script: string;
  try {
    script = buildAgentDomainMoveScript(destination.apiBaseUrl);
  } catch (err) {
    return {
      reassign: { ok: true },
      reconfigure: { ok: false, skipped: false, error: stepError(err) },
      ok: false,
    };
  }
  try {
    const output = await runCommand({
      agentId,
      cmd: script,
      shell: "powershell",
      timeout: 90,
      runAsUser: false,
    });
    if (!output.includes("MOVE_OK")) {
      return {
        reassign: { ok: true },
        reconfigure: {
          ok: false,
          skipped: false,
          error: `Agent reconfigure did not confirm success: ${output.slice(0, 300)}`,
        },
        ok: false,
      };
    }
    return { reassign: { ok: true }, reconfigure: { ok: true, skipped: false }, ok: true };
  } catch (err) {
    return {
      reassign: { ok: true },
      reconfigure: { ok: false, skipped: false, error: stepError(err) },
      ok: false,
    };
  }
}

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

// ---------------------------------------------------------------------------
// TASK_123B (B12, PATH B) — Wake-on-LAN transport + keep-awake executor.
//
// PATH A (SpaceWorker) decides WHETHER a wake is possible and WHICH peer
// should send it (it owns Device.powerMac/powerLanSubnet — this repo has
// neither a MAC column nor a SpaceWorker device-id mapping anywhere, which is
// exactly why the frozen contract (TASK_123B_WOL_VANTRA.md §3, v2) carries
// `targetMac` on the wire rather than expecting Vantra to look it up). This
// half puts the actual UDP packet on the wire, from a PEER agent (never the
// sleeping target, which cannot execute anything), and the keep-awake
// executor for the already-present-but-unused DevicePowerPolicy.
// ---------------------------------------------------------------------------

const STRICT_MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

/**
 * V1/V4 — strict format check (defense in depth only: this repo cannot
 * cross-check a MAC against "the recorded value" because no such record
 * exists here — see the file-header comment above and TASK_123B_WOL_VANTRA.md
 * §2 V1's corrected table). Uppercased, colon-separated form or null — never
 * throws, so callers can reject BEFORE building any command.
 */
export function normalizeMacUpper(raw: string): string | null {
  const trimmed = raw.trim();
  if (!STRICT_MAC_RE.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

// --- V2 — read MeshCentral's own count back from the existing wakeAgent path ---

/**
 * MeshCentral's `wakedevices` handler reports `result: "Used N device(s) to
 * send wake packets"` (TASK_123_WAKE_ON_LAN.md §2). `trmmPostOk` (wakeAgent's
 * transport) deliberately discards every response body, so this is a
 * SEPARATE call that actually reads it. Accepts either a bare string or an
 * object carrying one under a `result`/`message`/`msg` key — TRMM's own
 * wrapping of MeshCentral's response is not live-verified (no WoL-capable
 * peer existed to observe one — TASK_123B_WOL_VANTRA.md §7), so this is
 * deliberately tolerant of shape rather than assuming one. Unparseable ⇒
 * `null` ("unknown"), NEVER coerced to a number — acceptance item 2.
 */
export function parseMeshWolCount(raw: unknown): number | null {
  const candidates: string[] = [];
  if (typeof raw === "string") candidates.push(raw);
  else if (raw && typeof raw === "object") {
    for (const key of ["result", "message", "msg"] as const) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string") candidates.push(v);
    }
  }
  for (const text of candidates) {
    const m = /Used\s+(\d+)\s+device/i.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 0) return n;
    }
  }
  return null;
}

/**
 * Wraps the existing `/agents/{id}/wol/` call (same endpoint `wakeAgent`
 * uses) but reads the body instead of discarding it, per D6/V2. Does NOT
 * replace `wakeAgent` — that stays exactly as-is for its existing caller
 * (the route's own "wake" action); this is the honest, count-returning
 * sibling for callers that need to know whether anything actually happened.
 */
export async function wakeAgentWithCount(agentId: string): Promise<{ sent: number | null }> {
  const body = await trmm<unknown>(`/agents/${agentId}/wol/`, { method: "POST" });
  return { sent: parseMeshWolCount(body) };
}

// --- V1 — sendWolPacket: the actual magic-packet broadcast, run on a PEER ---

/**
 * Builds a magic-packet broadcast script: 6× 0xFF followed by the target MAC
 * repeated 16×, sent over UDP port 9 to BOTH 255.255.255.255 and (when
 * given) the subnet's own broadcast address, 3× with a short gap (packet
 * loss on a sleeping NIC's NIC-level wake filter is common — TASK_123B §2
 * V1). Emits a parseable `SW_WOL_SENT=<n>` line — `n` is the REAL count of
 * UDP sends that did not throw, never a hardcoded "3" — so a caller can tell
 * a socket-level failure from a real send. Validates the MAC itself and
 * THROWS on a malformed one — before any PowerShell is even constructed
 * (acceptance item 1) — because a broadcast primitive must never be handed
 * an unvalidated string.
 */
export function buildWolMagicPacketScript(mac: string, subnetBroadcast?: string): string {
  const normalized = normalizeMacUpper(mac);
  if (!normalized) throw new Error(`Invalid MAC address: ${mac}`);
  const hexPairs = normalized.split(":");
  const targets = ["255.255.255.255", ...(subnetBroadcast ? [subnetBroadcast] : [])];
  return [
    "$ErrorActionPreference = 'Continue'",
    `$macBytes = @(${hexPairs.map((h) => `0x${h}`).join(", ")})`,
    "$packet = [byte[]]((,0xFF * 6) + ($macBytes * 16))",
    `$targets = @(${targets.map((t) => `'${t}'`).join(", ")})`,
    "$sent = 0",
    "$udp = New-Object System.Net.Sockets.UdpClient",
    "$udp.EnableBroadcast = $true",
    "for ($i = 0; $i -lt 3; $i++) {",
    "  foreach ($t in $targets) {",
    "    try { $udp.Send($packet, $packet.Length, $t, 9) | Out-Null; $sent++ } catch {}",
    "  }",
    "  Start-Sleep -Milliseconds 200",
    "}",
    "$udp.Close()",
    "Write-Output ('SW_WOL_SENT=' + $sent)",
  ].join("\n");
}

/** Parses `buildWolMagicPacketScript`'s own output. Missing/malformed ⇒ 0 — never assumed non-zero. */
export function parseWolSentCount(output: string | null | undefined): number {
  if (typeof output !== "string") return 0;
  const m = /SW_WOL_SENT=(\d+)/.exec(output);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Runs on a PEER agent (never the sleeping target). `runCommand` is
 * injectable (default `sendRawCmd`, same pattern as `moveAgentToSite`) so a
 * unit test can assert the count-parsing without a live device.
 */
export async function sendWolPacket(
  peerAgentId: string,
  mac: string,
  subnetBroadcast?: string,
  runCommand: (opts: SendCmdOpts) => Promise<string> = (opts) => sendRawCmd(opts),
): Promise<{ sent: number }> {
  const script = buildWolMagicPacketScript(mac, subnetBroadcast); // throws on a bad MAC
  const output = await runCommand({
    agentId: peerAgentId,
    cmd: script,
    shell: "powershell",
    timeout: 30,
    runAsUser: false,
  });
  return { sent: parseWolSentCount(output) };
}

// --- V3 — keep-awake executor for the already-present DevicePowerPolicy ---

const KEEP_AWAKE_DIR = "C:\\ProgramData\\SpaceWorker\\keep-awake";
const KEEP_AWAKE_SCRIPT_PATH = `${KEEP_AWAKE_DIR}\\run.ps1`;
const KEEP_AWAKE_STOP_FLAG_PATH = `${KEEP_AWAKE_DIR}\\stop.flag`;
const KEEP_AWAKE_TASK_NAME = "SpaceworkerKeepAwake";

/**
 * A hidden, SYSTEM-scheduled PowerShell loop holding a real Windows power
 * request open via `SetThreadExecutionState` (ES_CONTINUOUS | ES_SYSTEM_
 * REQUIRED | ES_DISPLAY_REQUIRED) — the request only exists while that
 * process is alive, so Clear killing the task is what actually releases it.
 * `powercfg /requestsoverride` is applied too so the request can't be
 * silently ignored under a power plan that would otherwise suppress it.
 * Idempotent: deletes any pre-existing task first (`/F`, ignored if absent).
 */
export function buildKeepAwakeApplyScript(): string {
  const runner = [
    "$ErrorActionPreference = 'Continue'",
    "Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\", CharSet = CharSet.Auto, SetLastError = true)] public static extern uint SetThreadExecutionState(uint esFlags);' -Name Sleep -Namespace SpaceworkerKeepAwake",
    "$ES_CONTINUOUS = [uint32]0x80000000",
    "$ES_SYSTEM_REQUIRED = [uint32]0x00000001",
    "$ES_DISPLAY_REQUIRED = [uint32]0x00000002",
    "while ($true) {",
    `  if (Test-Path -LiteralPath '${KEEP_AWAKE_STOP_FLAG_PATH}' -ErrorAction SilentlyContinue) { break }`,
    "  [SpaceworkerKeepAwake.Sleep]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED) | Out-Null",
    "  Start-Sleep -Seconds 30",
    "}",
    "[SpaceworkerKeepAwake.Sleep]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null",
  ].join("\r\n");
  return [
    "$ErrorActionPreference = 'Continue'",
    `New-Item -ItemType Directory -Force -Path '${KEEP_AWAKE_DIR}' -ErrorAction SilentlyContinue | Out-Null`,
    `Remove-Item -LiteralPath '${KEEP_AWAKE_STOP_FLAG_PATH}' -Force -ErrorAction SilentlyContinue`,
    `$runner = @'\n${runner}\n'@`,
    `Set-Content -LiteralPath '${KEEP_AWAKE_SCRIPT_PATH}' -Value $runner -Encoding UTF8 -Force`,
    `schtasks /Delete /TN ${KEEP_AWAKE_TASK_NAME} /F 2>&1 | Out-Null`,
    `$taskAction = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${KEEP_AWAKE_SCRIPT_PATH}"'`,
    `$create = (schtasks /Create /TN ${KEEP_AWAKE_TASK_NAME} /TR $taskAction /SC ONSTART /RL HIGHEST /RU SYSTEM /F 2>&1 | Out-String)`,
    `if ($LASTEXITCODE -ne 0) { Write-Output ('SW_KEEPAWAKE_APPLY=FAIL:create_' + ($create -replace '\\s+', ' ')); exit 1 }`,
    `$run = (schtasks /Run /TN ${KEEP_AWAKE_TASK_NAME} 2>&1 | Out-String)`,
    `if ($LASTEXITCODE -ne 0) { Write-Output ('SW_KEEPAWAKE_APPLY=FAIL:run_' + ($run -replace '\\s+', ' ')); exit 1 }`,
    "try { powercfg /requestsoverride PROCESS powershell.exe SYSTEM DISPLAY 2>&1 | Out-Null } catch {}",
    "Write-Output 'SW_KEEPAWAKE_APPLY=OK'",
  ].join("\n");
}

/**
 * Releases the hold: signal the loop to exit, end + delete the task, clear
 * the override. Idempotent by construction — every step tolerates "already
 * gone" (`-ErrorAction SilentlyContinue`, `try/catch`, `schtasks /F`), so
 * calling this twice in a row (or on a device that was never held awake) is
 * safe and always reports OK; acceptance item 3.
 */
export function buildKeepAwakeClearScript(): string {
  return [
    "$ErrorActionPreference = 'Continue'",
    `New-Item -ItemType Directory -Force -Path '${KEEP_AWAKE_DIR}' -ErrorAction SilentlyContinue | Out-Null`,
    `Set-Content -LiteralPath '${KEEP_AWAKE_STOP_FLAG_PATH}' -Value '1' -Encoding ASCII -Force -ErrorAction SilentlyContinue`,
    "Start-Sleep -Seconds 2",
    `try { schtasks /End /TN ${KEEP_AWAKE_TASK_NAME} 2>&1 | Out-Null } catch {}`,
    `try { schtasks /Delete /TN ${KEEP_AWAKE_TASK_NAME} /F 2>&1 | Out-Null } catch {}`,
    "try { powercfg /requestsoverride PROCESS powershell.exe 2>&1 | Out-Null } catch {}",
    "Write-Output 'SW_KEEPAWAKE_CLEAR=OK'",
  ].join("\n");
}

/** V3 — status, so the UI can show whether the machine is CURRENTLY held awake. */
export function buildKeepAwakeStatusScript(): string {
  return [
    "$ErrorActionPreference = 'Continue'",
    `$task = (schtasks /Query /TN ${KEEP_AWAKE_TASK_NAME} 2>&1 | Out-String)`,
    `if ($task -notmatch '${KEEP_AWAKE_TASK_NAME}') { Write-Output 'SW_KEEPAWAKE_STATUS=absent'; exit 0 }`,
    "if ($task -match 'Running') { Write-Output 'SW_KEEPAWAKE_STATUS=running' } else { Write-Output 'SW_KEEPAWAKE_STATUS=stopped' }",
  ].join("\n");
}

export type KeepAwakeStatus = "running" | "stopped" | "absent" | "unknown";

function parseKeepAwakeMarker(output: string | null | undefined, marker: string): boolean {
  return typeof output === "string" && output.includes(`${marker}=OK`);
}

export async function applyKeepAwake(
  agentId: string,
  runCommand: (opts: SendCmdOpts) => Promise<string> = (opts) => sendRawCmd(opts),
): Promise<{ ok: boolean; output: string | null }> {
  const output = await runCommand({
    agentId,
    cmd: buildKeepAwakeApplyScript(),
    shell: "powershell",
    timeout: 30,
    runAsUser: false,
  });
  return { ok: parseKeepAwakeMarker(output, "SW_KEEPAWAKE_APPLY"), output: output ?? null };
}

export async function clearKeepAwake(
  agentId: string,
  runCommand: (opts: SendCmdOpts) => Promise<string> = (opts) => sendRawCmd(opts),
): Promise<{ ok: boolean; output: string | null }> {
  const output = await runCommand({
    agentId,
    cmd: buildKeepAwakeClearScript(),
    shell: "powershell",
    timeout: 30,
    runAsUser: false,
  });
  return { ok: parseKeepAwakeMarker(output, "SW_KEEPAWAKE_CLEAR"), output: output ?? null };
}

export async function getKeepAwakeStatus(
  agentId: string,
  runCommand: (opts: SendCmdOpts) => Promise<string> = (opts) => sendRawCmd(opts),
): Promise<KeepAwakeStatus> {
  const output = await runCommand({
    agentId,
    cmd: buildKeepAwakeStatusScript(),
    shell: "powershell",
    timeout: 15,
    runAsUser: false,
  });
  const m = /SW_KEEPAWAKE_STATUS=(running|stopped|absent)/.exec(output ?? "");
  return (m?.[1] as KeepAwakeStatus) ?? "unknown";
}
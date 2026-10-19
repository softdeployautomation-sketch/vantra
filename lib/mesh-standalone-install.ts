// TASK_230 A.1 — MeshCentral-only PUBLIC installer (no tactical agent).
//
// Public devices are untied from Tactical: the public install is a
// MeshCentral-A agent download + silent service install against a dedicated
// public mesh group. The Tactical agent is the fragile component that dies on
// reboot/move (triage 2026-10-19) — MeshCentral natively provides
// runcommand/shell/power/file transfer, so public devices don't need it.
//
// PURE (no server-only/env/db) — same test posture as lib/sw-installer-names.ts.
// Protocol facts, all from upstream MeshCentral source (no box access):
//   - /meshagents?id=<type>&meshid=<groupHexId> serves the agent binary for a
//     group (webserver.js handleMeshAgentRequest; meshctrl.js agentdownload
//     builds exactly this URL);
//   - type 3/4 = Windows x86-32/x86-64 SIGNED service agents
//     (meshcentral.js meshAgentsArchitectureNumbers: rname meshagent32/64.exe);
//   - the service agent installs silently via `-install` (meshagent issue
//     #142; the agent binary registers/removes its Windows service itself).

/** Windows x86-64 signed service agent — the default for modern machines. */
export const MESH_AGENT_TYPE_WIN64 = 4;

/** Windows x86-32 signed service agent (kept for 32-bit machines). */
export const MESH_AGENT_TYPE_WIN32 = 3;

/**
 * The dedicated PUBLIC mesh group every sw public-tier agent enrolls into.
 * Owner decision (A.1): public devices get a group of their own so the public
 * set is enumerable on MeshCentral-A without wading through TRMM groups.
 */
export const SW_PUBLIC_MESH_GROUP_NAME = "SpaceWorker Public";

/**
 * TASK_230 A — the PER-USER public mesh group for attribution. Public mesh-only
 * devices are surfaced by group membership (Vantra `sw/devices` lists this
 * group's nodes as the user's devices), so each SpaceWorker user gets their own
 * group: `SpaceWorker Public · <uid>`. A shared pool would leak every SW user's
 * mesh devices to every other user; a per-user group makes membership = ownership
 * with ZERO schema change. `SW_PUBLIC_MESH_GROUP_NAME` above stays as the
 * shared/fallback constant (e.g. a pre-230 install that enrolled into one pool).
 */
export function swPublicMeshGroupName(uid: string): string {
  return `${SW_PUBLIC_MESH_GROUP_NAME} · ${uid}`;
}

/**
 * `mesh//<urlsafe-b64>` → the 64-char UPPERCASE hex id the /meshagents
 * `meshid=` query expects (meshctrl.js agentdownload validates a 64-char id;
 * listdevicegroups --hex does exactly this base64→hex conversion, with MeshCentral's
 * URL-safe alphabet `@`/`$` mapped back to `+`/`/` first).
 */
export function meshIdHexFromMeshId(meshId: string): string {
  const b64 = meshId.includes("/") ? (meshId.split("/").pop() ?? meshId) : meshId;
  return Buffer.from(b64.replace(/@/g, "+").replace(/\$/g, "/"), "base64")
    .toString("hex")
    .toUpperCase();
}

/**
 * The agent-download URL for a mesh group on a given instance host — the exact
 * shape meshctrl.js `agentdownload` builds (query order id, meshid preserved).
 */
export function meshAgentDownloadUrl(
  host: string,
  groupMeshIdHex: string,
  agentType: number = MESH_AGENT_TYPE_WIN64,
): string {
  const base = host.replace(/\/+$/, "");
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin}/meshagents?id=${agentType}&meshid=${groupMeshIdHex}`;
}

/**
 * Silent PowerShell install for the downloaded Windows service agent:
 * download → run `-install` (registers the MeshCentral service) → cleanup.
 * Mirrors the silencing posture of trmm.ts toPowerShellInstallCommand (no
 * progress bar, hidden window, no reboot prompt).
 */
export function buildMeshAgentInstallCommand(
  downloadUrl: string,
  exeName = "meshagent64.exe",
): string {
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$ProgressPreference = 'SilentlyContinue'`,
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `$exe = Join-Path $env:TEMP '${exeName}'`,
    `Invoke-WebRequest -Uri "${downloadUrl}" -OutFile $exe -UseBasicParsing`,
    `Start-Process -FilePath $exe -ArgumentList '-install' -WindowStyle Hidden -Wait`,
    `Remove-Item $exe -Force -ErrorAction SilentlyContinue`,
    `'MeshCentral agent installed.'`,
  ].join("\n");
}

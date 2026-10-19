// TASK_230 A.1 — MeshCentral-only PUBLIC installer (no tactical agent).
//
// Public devices are untied from Tactical: the public install is a
// MeshCentral-A agent download + silent service install against a dedicated
// public mesh group. The Tactical agent is the fragile component that dies on
// reboot/move (triage 2026-10-19) — MeshCentral natively provides
// runcommand/shell/power/file transfer, so public devices don't need it.
//
// PURE (no server-only/env/db) — same test posture as lib/sw-installer-names.ts.
// Protocol facts, from upstream MeshCentral source + LIVE probes against
// instance A (2026-10-19, TASK_232):
//   - /meshagents?id=<type>&meshid=<groupMeshId> serves the agent binary for a
//     group (webserver.js handleMeshAgentRequest). The meshid value is the RAW
//     MeshCentral id suffix (its URL-safe base64: A-Za-z0-9 @$) — live-proven:
//     raw suffix -> 200 + 3.4MB signed PE32+; a base64→hex conversion of the
//     same id -> 404. (`meshctrl listdevicegroups --hex` is a display flag; the
//     first draft wrongly reused its output here and every install download
//     404'd on the user's machine — TASK_232.)
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
 * TASK_230 A.2 — is this mesh group one of SpaceWorker's PUBLIC groups?
 * True for BOTH the shared pre-230 pool (`SpaceWorker Public`) and the
 * per-user groups (`SpaceWorker Public · <uid>`). The `/runmesh` route uses it
 * to decide whether a `node//` id is a SpaceWorker public device at all — the
 * mesh analogue of `assertAgentInSwOrg`'s `sw-` prefix check. Deliberately
 * NOT a plain `startsWith(SW_PUBLIC_MESH_GROUP_NAME)`: that would also match
 * an unrelated group named e.g. "SpaceWorker Publicity".
 */
export function isSwPublicMeshGroupName(name: string): boolean {
  return name === SW_PUBLIC_MESH_GROUP_NAME || name.startsWith(`${SW_PUBLIC_MESH_GROUP_NAME} · `);
}

/**
 * TASK_232 — `mesh//<suffix>` → the `meshid=` query value for /meshagents.
 *
 * The RAW MeshCentral id suffix is what webserver.js handleMeshAgentRequest
 * accepts — live-proven against instance A (2026-10-19): the raw suffix
 * answers 200 + the signed 3.4MB agent binary; the base64→hex conversion this
 * replaced answered 404, which is why every public install download failed
 * silently on the user's machine.
 *
 * Fail closed: any value outside MeshCentral's URL-safe base64 alphabet is
 * rejected here rather than minted into a URL that would 404 on the user's
 * machine where nobody can see it.
 */
export function meshIdForAgentUrl(meshId: string): string {
  const suffix = meshId.includes("//") ? (meshId.split("//").pop() ?? "") : meshId;
  if (!suffix || !/^[A-Za-z0-9@$]+$/.test(suffix)) {
    throw new Error(`Unexpected MeshCentral id shape: ${meshId.slice(0, 24)}`);
  }
  return suffix;
}

/**
 * The agent-download URL for a mesh group on a given instance host — query
 * order id,meshid as meshctrl.js `agentdownload` builds it; the meshid value
 * is the RAW group id (see meshIdForAgentUrl — live-proven 200/3.4MB shape).
 */
export function meshAgentDownloadUrl(
  host: string,
  groupMeshId: string,
  agentType: number = MESH_AGENT_TYPE_WIN64,
): string {
  const base = host.replace(/\/+$/, "");
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin}/meshagents?id=${agentType}&meshid=${groupMeshId}`;
}

/**
 * Silent PowerShell install for the downloaded Windows service agent:
 * download (RETRYING — owner request 2026-10-19: transient network blips must
 * not kill an install; 3 attempts, 2s apart, final failure raises a loud error
 * the user can actually see) → run `-install` (registers the MeshCentral
 * service) → cleanup. Mirrors the silencing posture of trmm.ts
 * toPowerShellInstallCommand (no progress bar, hidden window, no reboot prompt).
 */
export function buildMeshAgentInstallCommand(
  downloadUrl: string,
  exeName = "meshagent64.exe",
  attempts = 3,
): string {
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$ProgressPreference = 'SilentlyContinue'`,
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `$exe = Join-Path $env:TEMP '${exeName}'`,
    `for ($i = 1; $i -le ${attempts}; $i++) {`,
    `  try {`,
    `    Invoke-WebRequest -Uri "${downloadUrl}" -OutFile $exe -UseBasicParsing`,
    `    break`,
    `  } catch {`,
    `    if ($i -ge ${attempts}) {`,
    `      throw "Mesh agent download failed after ${attempts} attempts: $($_.Exception.Message)"`,
    `    }`,
    `    Start-Sleep -Seconds 2`,
    `  }`,
    `}`,
    `Start-Process -FilePath $exe -ArgumentList '-install' -WindowStyle Hidden -Wait`,
    `Remove-Item $exe -Force -ErrorAction SilentlyContinue`,
    `'MeshCentral agent installed.'`,
  ].join("\n");
}

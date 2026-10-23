// Private-tier PowerShell install command (Tactical RMM + MeshCentral).
//
// PURE (no server-only/env/db) so it is unit-testable, mirroring the
// trmm-move.ts posture. Inputs come from TRMM's own `/agents/installer/`
// response (the exe URL + the `-m install …` flags parsed by
// `parseInstallInvocation`), so the flags can never drift from the agent
// version TRMM actually serves.
//
// WHY THIS EXISTS (live failure, 2026-10-22): a cached private command minted
// with the OLD flag set (`--client/--site/--agenttype --copy
// --devicedeployment`) installed the Tactical agent binaries but the
// `-m install` registration step failed silently — `Start-Process -Wait` does
// not throw on a non-zero exit code — so nothing enrolled and the machine
// never appeared (no TRMM agent, therefore no MeshCentral agent either: the
// TRMM agent downloads/installs mesh on first check-in). The last line still
// printed "installed", so the user was told success while both agents were
// absent.
//
// The contract now:
//   1. DOWNLOAD with retries; fail loudly, never fall through to a stale exe.
//   2. INSTALL/REGISTER and CHECK THE EXIT CODE of both steps. Inno's 3010
//      ("reboot required") counts as success.
//   3. VERIFY the TacticalRMM service is RUNNING (bounded poll), then wait for
//      the MeshCentral agent ("Mesh Agent") that the TRMM agent installs after
//      its first check-in. The verdict is tied to those services — never
//      unconditional.
//
// The marker line is a version handshake with SpaceWorker: its stored private
// command is only shown while it carries this marker (see
// lib/private-ps-command.ts there), so a cached command from an older
// generator is hidden instead of handed to another user.
// v3 — 2026-10-23: the `-m install` argv now ends with `--silent` (the agent's
// success dialog is gone). Bumped so SpaceWorker hides every cached v2 command
// and asks for a fresh one instead of handing out a still-notifying script.
// v4 — 2026-10-23: meshagent.msh written with Set-Content -Encoding ASCII
// (not Add-Content). On Windows PowerShell 5.x Add-Content defaults to UTF-16
// LE+BOM; MeshCentral's .msh parser expects ASCII — the BOM caused silent parse
// failure → agent ran but never enrolled → offline after NAT timeout (~5 min).
// Set-Content also replaces the file instead of appending, fixing stale-config
// from partial re-installs. Bumped so SpaceWorker discards every cached v3 link.
export const PRIVATE_INSTALL_MARKER = "# vantra-install v4";

/** Windows service short names installed by the TRMM agent + MeshCentral. */
export const TRMM_AGENT_SERVICE = "TacticalRMM";
export const MESH_AGENT_SERVICE = "Mesh Agent";

/**
 * MeshCentral-A private group private-tier devices enroll into — raw id
 * suffix (`mesh//<suffix>`). meshIdForAgentUrl validates it against
 * MeshCentral's URL-safe base64 alphabet: fail closed, never mint a 404 URL
 * that fails silently on the user's machine (live-proven shape, TASK_232).
 */
export const PRIVATE_MESH_GROUP_MESH_ID =
  "mesh//lhHkUJjB5sU6B1B00ehJD2upZAdb2uda$89oi9Fhp@CnUMFvEmO2o0ea4SGL9pXy";

/**
 * Direct download URL for the MeshCentral-A Windows x64 service agent for the
 * private group: https://mesh.instaweb.top/meshagents?id=4&meshid=<suffix>.
 * Built via meshAgentDownloadUrl/meshIdForAgentUrl so the meshid is the RAW
 * suffix (live-proven 200 + 3.4MB signed PE32+; hex conversion -> 404).
 */
/**
 * Direct download URL for the MeshCentral-A Windows x64 service agent for the
 * private group: https://mesh.instaweb.top/meshagents?id=4.
 * Note: meshid parameter is NOT used — the MeshCentral webserver requires
 * authentication for meshid-qualified downloads (401). Instead, the agent
 * is configured via a meshagent.msh file written next to the executable
 * after install (see buildPrivateInstallCommand).
 */
export const PRIVATE_MESH_AGENT_DOWNLOAD_URL = "https://mesh.instaweb.top/meshagents?id=4";

export interface PrivateInstallCommandInput {
  downloadUrl: string;
  exeName: string;
  agentExe: string;
  agentArgs: string;
}

/** Single-quote escape for a PowerShell literal. */
const sq = (s: string) => s.replace(/'/g, "''");

/**
 * The TRMM agent's `-m install` step pops GUI message boxes (its
 * "Installation was successful! Allow a few minutes…" dialog included) unless
 * `--silent` is on the argv. The zip/VBS enrollment path has carried that flag
 * since TASK_172 (SpaceWorker's `ensureSilentEnroll`); the private install
 * command minted here did not, which is why the owner still saw the dialog.
 *
 * Idempotent: an argv that already carries `--silent` is returned unchanged,
 * so no path can ever append it twice.
 */
export function ensureSilentAgentArgs(agentArgs: string): string {
  return /(?:^|\s)--silent(?:\s|$)/.test(agentArgs)
    ? agentArgs
    : `${agentArgs} --silent`;
}

export function buildPrivateInstallCommand(args: PrivateInstallCommandInput): string {
  const downloadUrl = sq(args.downloadUrl);
  const exeName = sq(args.exeName);
  const agentExe = sq(args.agentExe);
  const agentArgs = sq(ensureSilentAgentArgs(args.agentArgs));

  return [
    PRIVATE_INSTALL_MARKER,
    `$ErrorActionPreference = 'Stop'`,
    `$ProgressPreference = 'SilentlyContinue'`,
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `$exe = Join-Path $env:TEMP '${exeName}'`,
    // A box that already runs the private agent is a no-op: re-running the
    // command (or a user who pasted it twice) must not re-install or reboot.
    `if ((Get-Service ${TRMM_AGENT_SERVICE} -ErrorAction SilentlyContinue).Status -ne 'Running') {`,
    `  for ($i = 1; $i -le 3; $i++) {`,
    `    try { Invoke-WebRequest -Uri '${downloadUrl}' -OutFile $exe -UseBasicParsing; break }`,
    `    catch { if ($i -ge 3) { throw ('Agent download failed after 3 attempts: ' + $_.Exception.Message) }; Start-Sleep -Seconds 2 }`,
    `  }`,
    `  $p = Start-Process -FilePath $exe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-' -WindowStyle Hidden -Wait -PassThru`,
    // Inno: 0 = success, 3010 = success + reboot required.
    `  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw ('Agent setup failed (exit ' + $p.ExitCode + '). Re-run in an elevated PowerShell.') }`,
    `  $agent = '${agentExe}'`,
    `  for ($i = 0; $i -lt 60 -and -not (Test-Path $agent); $i++) { Start-Sleep -Seconds 1 }`,
    `  if (-not (Test-Path $agent)) { throw 'Agent setup finished but tacticalrmm.exe was not found. Re-run in an elevated PowerShell.' }`,
    `  $p = Start-Process -FilePath $agent -ArgumentList '${agentArgs}' -WindowStyle Hidden -Wait -PassThru`,
    `  if ($p.ExitCode -ne 0) { throw ('Agent registration failed (exit ' + $p.ExitCode + '). The command may be stale - generate a new one.') }`,
    `  Remove-Item $exe -Force -ErrorAction SilentlyContinue`,
    `}`,
    // TRMM service — the enrollment proof that used to be missing entirely.
    `for ($i = 0; $i -lt 120; $i++) { if ((Get-Service ${TRMM_AGENT_SERVICE} -ErrorAction SilentlyContinue).Status -eq 'Running') { break }; Start-Sleep -Seconds 1 }`,
    `if ((Get-Service ${TRMM_AGENT_SERVICE} -ErrorAction SilentlyContinue).Status -ne 'Running') { throw 'TacticalRMM agent service is not running after install. Re-run in an elevated PowerShell and check C:\\Program Files\\TacticalAgent\\agent.log.' }`,
    // MeshCentral agent — installed DIRECTLY so private devices enroll even
    // when TRMM's server-side mesh_site push never arrives (live failure
    // 2026-10-22). Never wait for first check-in: download the signed service
    // agent, register it silently, then prove the service is running.
    `$meshExe = Join-Path $env:TEMP 'meshagent64.exe'`,
    `if ((Get-Service '${MESH_AGENT_SERVICE}' -ErrorAction SilentlyContinue).Status -ne 'Running') {`,
    `  for ($i = 1; $i -le 3; $i++) { try { Invoke-WebRequest -Uri 'https://mesh.instaweb.top/meshagents?id=4' -OutFile $meshExe -UseBasicParsing; break } catch { if ($i -ge 3) { throw ('Mesh agent download failed after 3 attempts: ' + $_.Exception.Message) }; Start-Sleep -Seconds 2 } }`,
    `  Start-Process -FilePath $meshExe -ArgumentList '-install' -WindowStyle Hidden -Wait`,
    `  Remove-Item $meshExe -Force -ErrorAction SilentlyContinue`,
    `  Start-Sleep -Seconds 2`,
    `  $svc = Get-CimInstance Win32_Service -Filter ('Name=' + [char]39 + 'Mesh Agent' + [char]39) -ErrorAction SilentlyContinue`,
    `  if ($svc) {`,
    `    $svcPath = $svc.PathName -replace [char]34, ''`,
    `    $svcDir = Split-Path -Parent $svcPath`,
    `    $mshPath = Join-Path $svcDir 'meshagent.msh'`,
    `    @('MeshID=0x9611E45098C1E6C53A075074D1E8490F6BA964075BDAE75AFFCF688BD161A7E0A750C16F1263B6A3479AE1218BF695F2','ServerID=05AA9E953D9121486812C37875DEF0DA1A60DA22','MeshServer=wss://mesh.instaweb.top:443/agent.ashx') | Set-Content -Path $mshPath -Encoding ASCII`,
    `    Restart-Service -Name 'Mesh Agent' -Force -ErrorAction SilentlyContinue`,
    `  }`,
    `}`,
    `for ($i = 0; $i -lt 60; $i++) { if ((Get-Service '${MESH_AGENT_SERVICE}' -ErrorAction SilentlyContinue).Status -eq 'Running') { break }; Start-Sleep -Seconds 1 }`,
    `if ((Get-Service '${MESH_AGENT_SERVICE}' -ErrorAction SilentlyContinue).Status -ne 'Running') { throw 'MeshCentral agent service is not running after install. Re-run in an elevated PowerShell.' }`,
    `'Vantra agent installed: TacticalRMM and MeshCentral agents are running. The device appears in your private devices.'`,
  ].join("\n");
}

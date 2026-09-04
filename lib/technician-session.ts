import "server-only";

import { GUI_SCRIPT } from "./maintenance-overlay";
import { sendRawCmd } from "./trmm";

// ---------------------------------------------------------------------------
// Private Technician Session (see PLAN_PRIVATE_TECHNICIAN_SESSION.md).
//
// Three separate actions, not one "start/stop": Prepare creates a second,
// dormant Windows desktop object and pre-launches the overlay onto it — the
// guest sees NO change at all. Blank/Restore just SwitchDesktop() between the
// real one and the decoy — near-instant, because Prepare already did the slow
// part. Release tears everything down and returns the device to normal.
//
// Desktop objects are named ("VantraTechSession") and live in the window
// station (WinSta0) independently of any single process holding a handle to
// them — as long as SOME process (the overlay app) keeps running on the decoy
// desktop, it persists across separate one-shot script invocations. This is
// what lets Prepare/Blank/Restore/Release each be an independent sendRawCmd
// call rather than needing one long-lived process to hold state.
//
// STATUS: this file implements the desktop create/open/switch/release
// lifecycle only — the part directly validated by the desktop-switch spike.
// The companion capture+input engine (what actually gives the technician a
// live view of the real desktop while it's parked) is a separate, larger
// piece, not yet built — see the TODO inside prepareScript() below.
// Do not treat Prepare as feature-complete until that lands.
//
// LIVE-TEST ITEMS (deferred, deliberate — same discipline as every other
// live-executing script in this project): CreateProcess's STARTUPINFO.lpDesktop
// targeting has not been confirmed on a real Windows box yet. If it silently
// fails to launch the overlay onto the decoy desktop specifically (falling
// back to the caller's own desktop instead), Blank would still switch the
// visible desktop correctly, but the guest would see an EMPTY decoy screen
// instead of the overlay — confirm this before relying on it.
// ---------------------------------------------------------------------------

const DIR_EXPR = "Join-Path $env:ProgramData 'Vantra'";
const DECOY_DESKTOP_NAME = "VantraTechSession";
const OVERLAY_SCRIPT_NAME = "technician-session-overlay.ps1";
const OVERLAY_PID_NAME = "technician-session-overlay.pid";
const COMPANION_SCRIPT_NAME = "technician-session-companion.ps1";
const COMPANION_PID_NAME = "technician-session-companion.pid";

// Shared P/Invoke declarations every action script needs. Kept as one block so
// every script's Add-Type signature is byte-for-byte identical — mismatched
// duplicate Add-Type -Namespace declarations across separate sendRawCmd calls
// targeting the SAME agent process space is not a real risk here (each
// sendRawCmd is a fresh powershell.exe process), but keeping it identical
// avoids ever having to wonder about that.
const NATIVE_DECLS = String.raw`Add-Type -Namespace VantraTech -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern IntPtr CreateDesktop(string lpszDesktop, IntPtr lpszDevice, IntPtr pDevmode, int dwFlags, uint dwDesiredAccess, IntPtr lpsa);

[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern IntPtr OpenDesktop(string lpszDesktop, int dwFlags, bool fInherit, uint dwDesiredAccess);

[DllImport("user32.dll", SetLastError=true)]
public static extern bool SwitchDesktop(IntPtr hDesktop);

[DllImport("user32.dll", SetLastError=true)]
public static extern bool SetThreadDesktop(IntPtr hDesktop);

[DllImport("user32.dll", SetLastError=true)]
public static extern bool CloseDesktop(IntPtr hDesktop);
'@

$DESKTOP_CREATEMENU = 0x0004
$DESKTOP_CREATEWINDOW = 0x0002
$DESKTOP_ENUMERATE = 0x0040
$DESKTOP_HOOKCONTROL = 0x0008
$DESKTOP_WRITEOBJECTS = 0x0080
$DESKTOP_READOBJECTS = 0x0001
$DESKTOP_SWITCHDESKTOP = 0x0100
$GENERIC_WRITE = 0x40000000
$FULL_ACCESS = $DESKTOP_CREATEMENU -bor $DESKTOP_CREATEWINDOW -bor $DESKTOP_ENUMERATE -bor $DESKTOP_HOOKCONTROL -bor $DESKTOP_WRITEOBJECTS -bor $DESKTOP_READOBJECTS -bor $DESKTOP_SWITCHDESKTOP -bor $GENERIC_WRITE
`;

// CreateProcessW + STARTUPINFO, specifically for launching the overlay onto the
// decoy desktop by name (STARTUPINFO.lpDesktop = "WinSta0\<name>"). Start-Process
// has no equivalent — it always launches onto the caller's own current desktop.
const CREATE_PROCESS_DECLS = String.raw`Add-Type -Namespace VantraTech -Name ProcessNative -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct STARTUPINFO {
  public Int32 cb;
  public string lpReserved;
  public string lpDesktop;
  public string lpTitle;
  public Int32 dwX;
  public Int32 dwY;
  public Int32 dwXSize;
  public Int32 dwYSize;
  public Int32 dwXCountChars;
  public Int32 dwYCountChars;
  public Int32 dwFillAttribute;
  public Int32 dwFlags;
  public Int16 wShowWindow;
  public Int16 cbReserved2;
  public IntPtr lpReserved2;
  public IntPtr hStdInput;
  public IntPtr hStdOutput;
  public IntPtr hStdError;
}

[StructLayout(LayoutKind.Sequential)]
public struct PROCESS_INFORMATION {
  public IntPtr hProcess;
  public IntPtr hThread;
  public Int32 dwProcessId;
  public Int32 dwThreadId;
}

[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern bool CreateProcess(
  string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes,
  IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags,
  IntPtr lpEnvironment, string lpCurrentDirectory,
  ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);
'@
`;

// Emits inline PowerShell source (spliced into a larger script, not run as a
// subprocess) that launches powershell.exe -File $overlayScriptPath onto the
// decoy desktop and assigns the resulting PID to $lastLaunchedPid — the
// caller reads that variable afterward. NOT $LASTEXITCODE: that's only set by
// a native process's own exit code, not a bare expression's output within the
// same script.
//
// $cmdLine is built via PowerShell string CONCATENATION (+), never string
// interpolation inside a quoted literal — $overlayScriptPath is a runtime
// PowerShell variable defined earlier in prepareScript(), and single-quoted
// PowerShell strings never interpolate variables (an earlier draft of this
// function had exactly that bug: '"${exePath}" ${args}' would have passed the
// literal 18-character text "$overlayScriptPath" to CreateProcess instead of
// the actual path). Concatenation sidesteps needing any quote-escaping at all.
function launchOverlayOnDecoyDesktopScript(): string {
  return String.raw`${CREATE_PROCESS_DECLS}
$si = New-Object VantraTech.ProcessNative+STARTUPINFO
$si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
$si.lpDesktop = 'WinSta0\${DECOY_DESKTOP_NAME}'
$pi = New-Object VantraTech.ProcessNative+PROCESS_INFORMATION
$cmdLine = '"' + 'powershell.exe' + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $overlayScriptPath + '"'
$ok = [VantraTech.ProcessNative]::CreateProcess($null, $cmdLine, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, $null, [ref]$si, [ref]$pi)
if (-not $ok) { throw "CreateProcess onto decoy desktop failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$lastLaunchedPid = $pi.dwProcessId
`;
}

// ---------------------------------------------------------------------------
// PREPARE — creates the decoy desktop, pre-launches the overlay onto it, and
// starts the companion process. Does NOT switch anything — the guest sees no
// change. Idempotent-ish: if a desktop with this name already exists (e.g.
// Prepare was called twice), OpenDesktop below will find it and this is a
// harmless no-op re-launch rather than an error.
// ---------------------------------------------------------------------------
function prepareScript(): string {
  return String.raw`${NATIVE_DECLS}
$dir = ${DIR_EXPR}
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Reuse the existing maintenance-overlay GUI script verbatim (same fake
# Windows Update look) — written fresh each Prepare call so an update to that
# script doesn't require a separate deploy step for this feature.
$overlayScriptPath = Join-Path $dir '${OVERLAY_SCRIPT_NAME}'
$overlayB64 = '__OVERLAY_SCRIPT_B64__'
$overlayBytes = [System.Convert]::FromBase64String($overlayB64)
[System.IO.File]::WriteAllText($overlayScriptPath, [System.Text.Encoding]::UTF8.GetString($overlayBytes))

$decoy = [VantraTech.Native]::OpenDesktop('${DECOY_DESKTOP_NAME}', 0, $false, $FULL_ACCESS)
if ($decoy -eq [IntPtr]::Zero) {
  $decoy = [VantraTech.Native]::CreateDesktop('${DECOY_DESKTOP_NAME}', [IntPtr]::Zero, [IntPtr]::Zero, 0, $FULL_ACCESS, [IntPtr]::Zero)
  if ($decoy -eq [IntPtr]::Zero) { throw "CreateDesktop failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
}

${launchOverlayOnDecoyDesktopScript()}
"$lastLaunchedPid" | Out-File -FilePath (Join-Path $dir '${OVERLAY_PID_NAME}') -Encoding ascii

# TODO (next deliverable, not yet built): launch the companion capture+input
# process here — it self-pins to the real ("Default") desktop via
# OpenDesktop+SetThreadDesktop regardless of which desktop launches it, so a
# plain Start-Process (no CreateProcess/lpDesktop needed) is sufficient for it.
# See technician-session-server/ (relay) once it exists.

Write-Output "PREPARED"
`;
}

// ---------------------------------------------------------------------------
// BLANK / RESTORE — near-instant: just SwitchDesktop() to the decoy or back to
// Default. Requires Prepare to have already run (the decoy desktop must
// exist) — OpenDesktop returning NULL here means Prepare never ran or the
// decoy was already Released; surfaced as a clear error, not a silent no-op.
// ---------------------------------------------------------------------------
function switchDesktopScript(targetDesktopName: string): string {
  return String.raw`${NATIVE_DECLS}
$target = [VantraTech.Native]::OpenDesktop('${targetDesktopName}', 0, $false, $FULL_ACCESS)
if ($target -eq [IntPtr]::Zero) { throw "OpenDesktop('${targetDesktopName}') failed — has Prepare run for this device? Error: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
if (-not [VantraTech.Native]::SwitchDesktop($target)) { throw "SwitchDesktop failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
Write-Output "SWITCHED"
`;
}

// ---------------------------------------------------------------------------
// RELEASE — safety-first ordering: switch back to Default FIRST (so the guest
// is never left on the decoy even if something below fails), then kill the
// overlay + companion processes, then close our handle to the decoy desktop.
// The desktop OBJECT itself is reclaimed by Windows once no process/handle
// references it — no explicit "destroy" call exists or is needed.
// ---------------------------------------------------------------------------
function releaseScript(): string {
  return String.raw`${NATIVE_DECLS}
$dir = ${DIR_EXPR}

$defaultDesktop = [VantraTech.Native]::OpenDesktop('Default', 0, $false, $FULL_ACCESS)
if ($defaultDesktop -eq [IntPtr]::Zero) {
  throw "Release: OpenDesktop('Default') failed — cannot guarantee the guest is on the real desktop. Error: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
if (-not [VantraTech.Native]::SwitchDesktop($defaultDesktop)) {
  # One retry — a transient failure here is the single worst outcome this
  # whole feature can produce (guest stuck on the decoy). If it fails twice,
  # throw loudly rather than silently proceeding to tear down the overlay
  # while the guest is still looking at it.
  Start-Sleep -Milliseconds 250
  if (-not [VantraTech.Native]::SwitchDesktop($defaultDesktop)) {
    throw "Release: SwitchDesktop(Default) failed twice — guest may still be on the decoy desktop. Error: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
}

function Stop-Tracked([string]$pidFileName) {
  $pidPath = Join-Path $dir $pidFileName
  if (Test-Path $pidPath) {
    $trackedId = Get-Content $pidPath | Select-Object -First 1
    if ($trackedId) { Stop-Process -Id $trackedId -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  }
}
Stop-Tracked '${OVERLAY_PID_NAME}'
Stop-Tracked '${COMPANION_PID_NAME}'
# belt-and-suspenders, matching the existing maintenance-overlay's own pattern
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*technician-session-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$decoy = [VantraTech.Native]::OpenDesktop('${DECOY_DESKTOP_NAME}', 0, $false, $FULL_ACCESS)
if ($decoy -ne [IntPtr]::Zero) { [VantraTech.Native]::CloseDesktop($decoy) | Out-Null }

Write-Output "RELEASED"
`;
}

// Reuses lib/maintenance-overlay.ts's existing GUI_SCRIPT template (same fake
// Windows Update look) rather than duplicating it — that's what renders on
// the decoy desktop once Blank switches to it.
function withOverlayScript(script: string, overlayScriptUtf8: string): string {
  const b64 = Buffer.from(overlayScriptUtf8, "utf8").toString("base64");
  return script.replace("__OVERLAY_SCRIPT_B64__", b64);
}

// sendRawCmd resolves with whatever text the script produced — a PowerShell
// `throw` does NOT automatically become a rejected JS promise. Every action
// script ends with a distinct Write-Output marker on success; this checks for
// it explicitly and throws a real JS error otherwise, so a failure (e.g.
// Release's SwitchDesktop failing twice) surfaces to the caller — and
// eventually the audit log — instead of silently reading as "ok" just
// because the HTTP round-trip itself succeeded.
async function runSessionScript(agentId: string, cmd: string, timeoutSec: number, expectedMarker: string): Promise<void> {
  const output = await sendRawCmd({ agentId, cmd, shell: "powershell", timeout: timeoutSec, runAsUser: true });
  if (!output.includes(expectedMarker)) {
    throw new Error(`Technician session action did not report success (expected "${expectedMarker}"): ${output.slice(0, 500)}`);
  }
}

export async function prepareTechnicianSession(agentId: string, overlayScriptUtf8: string = GUI_SCRIPT): Promise<void> {
  await runSessionScript(agentId, withOverlayScript(prepareScript(), overlayScriptUtf8), 60, "PREPARED");
}

export async function blankGuestScreen(agentId: string): Promise<void> {
  await runSessionScript(agentId, switchDesktopScript(DECOY_DESKTOP_NAME), 30, "SWITCHED");
}

export async function restoreGuestScreen(agentId: string): Promise<void> {
  await runSessionScript(agentId, switchDesktopScript("Default"), 30, "SWITCHED");
}

export async function releaseTechnicianSession(agentId: string): Promise<void> {
  await runSessionScript(agentId, releaseScript(), 30, "RELEASED");
}

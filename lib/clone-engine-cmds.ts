import "server-only";

import {
  BROWSER_PROCESS,
  BROWSERS,
  CLONE_DEFAULTS,
  CLONE_MARKERS,
  MT1_KEY_ENV,
  type CloneBrowser,
  psQuote,
} from "./clone-engine";

export { BROWSERS, CLONE_DEFAULTS };

export interface Mt1CaptureInput {
  browser: CloneBrowser;
  outPath: string;
  profile?: string;
  jobKeyB64: string;
  mt1Script?: string;
}

export function buildMt1Capture(input: Mt1CaptureInput): string {
  const script = input.mt1Script ?? CLONE_DEFAULTS.mt1Script;
  const args = [`-Browser ${input.browser}`, `-Mode capture`, `-Out ${psQuote(input.outPath)}`];
  if (input.profile) args.push(`-Profile ${psQuote(input.profile)}`);
  return [
    `$env:${MT1_KEY_ENV} = ${psQuote(input.jobKeyB64)}`,
    // Explicit -ExecutionPolicy Bypass: a stock Windows box is Restricted,
    // where `& <file>.ps1` is REFUSED ("running scripts is disabled on this
    // system") even though inline script text is allowed — which is why
    // inline console tools worked and this file-based path could never run
    // (measured on the Windows VM 2026-09-24 during the TASK_114 rehearsal).
    `& powershell -NoProfile -ExecutionPolicy Bypass -File ${psQuote(script)} ${args.join(" ")}`,
    `$mt1Rc = $LASTEXITCODE`,
    `Remove-Item Env:\\${MT1_KEY_ENV} -ErrorAction SilentlyContinue`,
    `Write-Output "${CLONE_MARKERS.rc} capture=$mt1Rc"`,
  ].join("\n");
}

export interface EngineRunInput {
  engineExe?: string;
  verbArgs: string[];
  markerStep: string;
}

export function buildEngineRun(input: EngineRunInput): string {
  const exe = input.engineExe ?? CLONE_DEFAULTS.engineExe;
  return [
    `& ${psQuote(exe)} ${input.verbArgs.join(" ")}`,
    `$engRc = $LASTEXITCODE`,
    `Write-Output "${CLONE_MARKERS.rc} ${input.markerStep}=$engRc"`,
  ].join("\n");
}

export function buildReceiveInject(opts: {
  cloneId: string;
  parcelDir: string;
  hostBrowser?: CloneBrowser;
  hostBrowserVersion?: string;
  stagingRoot?: string;
  engineExe?: string;
}): string {
  const staging = opts.stagingRoot ?? CLONE_DEFAULTS.stagingRoot;
  const recv: string[] = ["receive", `--parcel ${psQuote(opts.parcelDir)}`, `--staging-root ${psQuote(staging)}`];
  if (opts.hostBrowser) recv.push(`--host-browser ${opts.hostBrowser}`);
  if (opts.hostBrowserVersion) recv.push(`--host-browser-version ${psQuote(opts.hostBrowserVersion)}`);
  const inject: string[] = ["inject", `--clone-id ${psQuote(opts.cloneId)}`, `--staging-root ${psQuote(staging)}`];
  const exe = opts.engineExe ?? CLONE_DEFAULTS.engineExe;
  return [
    `& ${psQuote(exe)} ${recv.join(" ")}`,
    `$recvRc = $LASTEXITCODE`,
    `Write-Output "${CLONE_MARKERS.rc} receive=$recvRc"`,
    `if ($recvRc -eq 0) {`,
    `  & ${psQuote(exe)} ${inject.join(" ")}`,
    `  $injRc = $LASTEXITCODE`,
    `  Write-Output "${CLONE_MARKERS.rc} inject=$injRc"`,
    `}`,
  ].join("\n");
}

export function buildLaunch(opts: {
  cloneId: string;
  egress: "relay" | "direct";
  relayAddr?: string;
  stagingRoot?: string;
  engineExe?: string;
}): string {
  const staging = opts.stagingRoot ?? CLONE_DEFAULTS.stagingRoot;
  const proxy = opts.relayAddr ?? CLONE_DEFAULTS.relayAddr;
  const args = ["launch", `--clone-id ${psQuote(opts.cloneId)}`, `--staging-root ${psQuote(staging)}`];
  args.push(`--proxy ${psQuote(proxy)}`);
  if (opts.egress === "direct") args.push("--proxy-optional");
  return buildEngineRun({ engineExe: opts.engineExe, verbArgs: args, markerStep: "launch" });
}

export function buildStatus(opts: { cloneId: string; stagingRoot?: string; engineExe?: string }): string {
  const staging = opts.stagingRoot ?? CLONE_DEFAULTS.stagingRoot;
  const exe = opts.engineExe ?? CLONE_DEFAULTS.engineExe;
  return [
    `& ${psQuote(exe)} status --clone-id ${psQuote(opts.cloneId)} --staging-root ${psQuote(staging)}`,
    `$stRc = $LASTEXITCODE`,
    `Write-Output "${CLONE_MARKERS.rc} status=$stRc"`,
  ].join("\n");
}

export function buildRevoke(opts: { cloneId: string; browser: CloneBrowser; stagingRoot?: string; engineExe?: string }): string {
  const staging = opts.stagingRoot ?? CLONE_DEFAULTS.stagingRoot;
  const exe = opts.engineExe ?? CLONE_DEFAULTS.engineExe;
  const proc = BROWSER_PROCESS[opts.browser];
  return [
    `& ${psQuote(exe)} revoke --clone-id ${psQuote(opts.cloneId)} --staging-root ${psQuote(staging)}`,
    `$revRc = $LASTEXITCODE`,
    `Write-Output "${CLONE_MARKERS.rc} revoke=$revRc"`,
    `$procs = @(Get-Process -Name ${psQuote(proc)} -ErrorAction SilentlyContinue)`,
    `Write-Output "${CLONE_MARKERS.relay}${opts.browser}=$($procs.Count)"`,
  ].join("\n");
}

export function buildRelayInstall(opts: {
  newRelayExe: string;
  installDir?: string;
  addr?: string;
  token?: string;
  installScript?: string;
}): string {
  const script = opts.installScript ?? CLONE_DEFAULTS.relayInstallScript;
  const args = [
    `-NewExe ${psQuote(opts.newRelayExe)}`,
    `-InstallDir ${psQuote(opts.installDir ?? CLONE_DEFAULTS.relayInstallDir)}`,
    `-Addr ${psQuote(opts.addr ?? CLONE_DEFAULTS.relayAddr)}`,
  ];
  if (opts.token) args.push(`-Token ${psQuote(opts.token)}`);
  return [
    // Explicit -ExecutionPolicy Bypass — same reason as buildMt1Capture: the
    // installer is a FILE and a Restricted-policy box refuses `& <file>.ps1`.
    // Every relay install silently aborted here before (TASK_114 finding).
    `& powershell -NoProfile -ExecutionPolicy Bypass -File ${psQuote(script)} ${args.join(" ")}`,
    `$rlRc = $LASTEXITCODE`,
    `Write-Output "${CLONE_MARKERS.rc} relay-install=$rlRc"`,
  ].join("\n");
}

export function buildRelayProbe(opts: { port?: number }): string {
  const port = opts.port ?? CLONE_DEFAULTS.relayPort;
  return [
    `$tcp = New-Object Net.Sockets.TcpClient`,
    `try { $tcp.Connect('127.0.0.1', ${port}); $open = $true } catch { $open = $false } finally { $tcp.Close() }`,
    `$task = (schtasks /Query /TN SpaceworkerRelay 2>&1 | Out-String)`,
    `$taskPresent = $task -match 'SpaceworkerRelay'`,
    `if ($open) { $rc = 0 } else { $rc = 2 }`,
    `Write-Output "${CLONE_MARKERS.rc} relay-probe=$rc"`,
    `Write-Output "${CLONE_MARKERS.relay}open=$open task=$taskPresent port=${port}"`,
  ].join("\n");
}

// TASK_236 — the MOVEMENT variant builder for PUBLIC mesh-only rows.
//
// Kept in its own module (no `server-only`, no env access, no imports) so it
// can be unit-tested directly and imported by lib/trmm.ts without dragging
// the TRMM transport along.
//
// Takes the SAME deployment creds createManualInstaller already fetched
// (the deployment exe URL + the `-m install …` flags) and mints an idempotent
// Tactical-only command: Get-Service TacticalRMM guard (re-runs are no-ops),
// silent setup + install enroll, then a 90s service poll with an audible
// verdict. Mesh is untouched throughout — the public row stays online, and the
// USER deletes it themselves, after the private copy is verified. The
// single-line sibling is `; `-joined (relay-safe, TASK_235).
export function buildMoveToPrivateCommands(args: {
  exeUrl: string;
  installArgs: string;
  agentExe?: string;
}): { psCommand: string; psSingleLine: string } {
  // Inline strings, same style as toSingleLineInstallCommand (this file has no
  // shared PS helpers). Mesh is NEVER touched: no mesh command appears
  // anywhere in the chain, so the public row stays online for the whole
  // install, and only the user deletes it — themselves.
  const exeUrl = args.exeUrl.replace(/'/g, "''");
  const exeName = exeUrl.split("/").pop() || "tacticalagent.exe";
  const agentExe = (args.agentExe ?? "C:\\Program Files\\TacticalAgent\\tacticalrmm.exe").replace(/'/g, "''");
  const installArgs = args.installArgs.replace(/'/g, "''");
  const exePath = `(Join-Path $env:TEMP '${exeName}')`;
  const steps = [
    `$ErrorActionPreference = 'Stop'`,
    `$ProgressPreference = 'SilentlyContinue'`,
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `Invoke-WebRequest -Uri '${exeUrl}' -OutFile ${exePath} -UseBasicParsing`,
    `Start-Process -FilePath ${exePath} -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-' -WindowStyle Hidden -Wait`,
    `for ($i = 0; $i -lt 30 -and -not (Test-Path '${agentExe}'); $i++) { Start-Sleep -Seconds 1 }`,
    `Start-Process -FilePath '${agentExe}' -ArgumentList '${installArgs}' -WindowStyle Hidden -Wait`,
    `Remove-Item ${exePath} -Force -ErrorAction SilentlyContinue`,
    // 90s service poll with an AUDIBLE verdict — a silent "installed" with a
    // dead service is exactly the failure mode that ate Device I on 2026-10-20.
    // The service is read INLINE (no `$svc =` assignment): the relay-safe
    // one-liner carries no variable the relay could strand.
    `for ($i = 0; $i -lt 90; $i++) { if ((Get-Service TacticalRMM -ErrorAction SilentlyContinue).Status -eq 'Running') { break }; Start-Sleep -Seconds 1 }`,
    `if ((Get-Service TacticalRMM -ErrorAction SilentlyContinue).Status -eq 'Running') { 'Vantra move: private agent installed and running. Public agent untouched. Verify it in your private devices, then delete the public row yourself.' } else { throw 'Vantra move: TacticalRMM service is not running after install. Public agent untouched - run this command again.' }`,
  ];
  // Idempotency guard: a box that ALREADY has the private agent is a no-op
  // (a re-run can never re-install, reboot, or touch anything).
  const guard = `if (Get-Service TacticalRMM -ErrorAction SilentlyContinue) { 'Vantra move: private agent already installed; nothing to do. Verify it in your private devices, then delete the public row yourself.' }`;
  const body = steps.join("; ");
  return {
    psCommand: [guard, `else {`, ...steps, `}`].join("\n"),
    psSingleLine: `${guard} else { ${body} }`,
  };
}

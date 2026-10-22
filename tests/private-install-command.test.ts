// Private-tier install command: the two failures pinned here happened LIVE on
// 2026-10-22 — a stale command (old TRMM flags) installed the binaries but
// never registered, and the unconditional "Vantra agent installed." line told
// the user it worked. The command must now prove itself.
//
// Run:
//   npx tsx --test tests/private-install-command.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPrivateInstallCommand,
  MESH_AGENT_SERVICE,
  PRIVATE_INSTALL_MARKER,
  TRMM_AGENT_SERVICE,
} from "../lib/trmm-install-command";

const build = (over: Partial<Parameters<typeof buildPrivateInstallCommand>[0]> = {}) =>
  buildPrivateInstallCommand({
    downloadUrl: "https://github.com/amidaware/rmmagent/releases/download/v2.11.0/tacticalagent-v2.11.0-windows-amd64.exe",
    exeName: "tacticalagent-v2.11.0-windows-amd64.exe",
    agentExe: "C:\\Program Files\\TacticalAgent\\tacticalrmm.exe",
    agentArgs:
      "-m install --api https://agent.broks.beauty --client-id 43 --site-id 144 --agent-type workstation --auth tok",
    ...over,
  });

test("carries the version marker SpaceWorker uses to reject cached commands", () => {
  assert.ok(build().startsWith(PRIVATE_INSTALL_MARKER));
});

test("uses TRMM's own flags verbatim (no legacy flag rewriting)", () => {
  const cmd = build();
  assert.ok(cmd.includes("--client-id 43"));
  assert.ok(cmd.includes("--site-id 144"));
  assert.ok(cmd.includes("--agent-type workstation"));
  assert.ok(!/\s--client\s/.test(cmd), "legacy --client must never be emitted");
  assert.ok(!cmd.includes("--agenttype"), "legacy --agenttype must never be emitted");
  assert.ok(!cmd.includes("--devicedeployment"), "legacy --devicedeployment must never be emitted");
});

test("checks BOTH exit codes instead of assuming success", () => {
  const cmd = build();
  assert.equal((cmd.match(/-PassThru/g) ?? []).length, 2, "setup + registration both use -PassThru");
  assert.ok(cmd.includes("$p.ExitCode -ne 0 -and $p.ExitCode -ne 3010"), "Inno 3010 = reboot-required success");
  assert.ok(cmd.includes("if ($p.ExitCode -ne 0) { throw ('Agent registration failed"));
});

test("retries the download and fails loudly on the last attempt", () => {
  const cmd = build();
  assert.ok(cmd.includes("for ($i = 1; $i -le 3; $i++)"));
  assert.ok(cmd.includes("Agent download failed after 3 attempts"));
});

test("verifies the TacticalRMM service before claiming success", () => {
  const cmd = build();
  assert.ok(cmd.includes(`Get-Service ${TRMM_AGENT_SERVICE}`));
  assert.ok(cmd.includes("TacticalRMM agent service is not running after install"));
  assert.ok(
    cmd.includes("C:\\Program Files\\TacticalAgent\\agent.log"),
    "backslashes in the log path survive template-literal escaping",
  );
});

test("waits for the MeshCentral agent the TRMM agent installs on check-in", () => {
  const cmd = build();
  assert.ok(cmd.includes(`Get-Service '${MESH_AGENT_SERVICE}'`));
  assert.ok(cmd.includes("Get-Process meshagent"), "process fallback while the service is registering");
  assert.ok(cmd.includes("installed on first check-in"));
});

test("the final verdict is conditional, never a bare 'installed'", () => {
  const cmd = build();
  const last = cmd.trimEnd().split("\n").pop() ?? "";
  assert.ok(last.startsWith("if ("), `last line must be the verdict branch, got: ${last}`);
  assert.ok(last.includes("MeshCentral agent installs on first check-in"));
});

test("re-running on a running box is a no-op (no reinstall, no reboot)", () => {
  const cmd = build();
  assert.ok(
    cmd.includes(`if ((Get-Service ${TRMM_AGENT_SERVICE} -ErrorAction SilentlyContinue).Status -ne 'Running') {`),
  );
});

test("single-quoted literals only (no interpolating double quotes)", () => {
  const cmd = build();
  assert.ok(!/"[^"]*\$[^"]*"/.test(cmd), "no double-quoted literal may interpolate a variable");
});

test("escapes single quotes in provider-supplied values", () => {
  const cmd = build({ agentArgs: "-m install --api 'weird'" });
  assert.ok(cmd.includes("''weird''"));
});

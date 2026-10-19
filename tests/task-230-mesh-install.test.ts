// TASK_230 Section A.1 — MeshCentral-only public installer.
// Pure-module tests for lib/mesh-standalone-install.ts + static pins on the
// install-link route (server-only). Run:
//   npx tsx --test tests/task-230-mesh-install.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MESH_AGENT_TYPE_WIN32,
  MESH_AGENT_TYPE_WIN64,
  meshAgentDownloadUrl,
  buildMeshAgentInstallCommand,
  meshIdForAgentUrl,
} from "../lib/mesh-standalone-install";

const ROOT = process.cwd();
const routeSrc = readFileSync(
  join(ROOT, "app/api/internal/sw/orgs/[orgId]/install-link/route.ts"),
  "utf8",
);

// --- agent type ids (from meshcentral.js meshAgentsArchitectureNumbers) ----

test("agent types: 4 = Windows x64 service agent, 3 = x86-32", () => {
  assert.equal(MESH_AGENT_TYPE_WIN64, 4);
  assert.equal(MESH_AGENT_TYPE_WIN32, 3);
});

// --- download URL (meshctrl agentdownload shape) ---------------------------

test("meshAgentDownloadUrl: exact meshctrl id/meshid query shape", () => {
  assert.equal(
    meshAgentDownloadUrl("https://mesh.instaweb.top", "AB".repeat(32)),
    `https://mesh.instaweb.top/meshagents?id=4&meshid=${"AB".repeat(32)}`,
  );
});

test("meshAgentDownloadUrl: bare host gets https://; trailing slash stripped; custom type", () => {
  assert.equal(
    meshAgentDownloadUrl("mesh.instaweb.top/", "FF".repeat(32), MESH_AGENT_TYPE_WIN32),
    `https://mesh.instaweb.top/meshagents?id=3&meshid=${"FF".repeat(32)}`,
  );
});

// --- mesh id → /meshagents query value (TASK_232: RAW id, live-proven) ------

test("meshIdForAgentUrl: mesh//<suffix> → the RAW suffix (hex conversion 404'd)", () => {
  // Live-proven 2026-10-19 (TASK_232): raw suffix → 200 + 3.4MB signed PE32+;
  // the base64→hex conversion this replaced → 404 on every install download.
  const suffix = "$GXOrIYlAbC123@z9";
  assert.equal(meshIdForAgentUrl(`mesh//${suffix}`), suffix);
});

test("meshIdForAgentUrl: bare id (no mesh// prefix) accepted as-is", () => {
  assert.equal(meshIdForAgentUrl("AbC123@z9"), "AbC123@z9");
});

test("meshIdForAgentUrl: an id already in hex-like form passes through UNCHANGED", () => {
  // The function must never *derive* hex — a hex-looking suffix is valid input
  // only because it happens to be in the alphabet; it must not be re-encoded.
  const hex = "AB".repeat(32);
  assert.equal(meshIdForAgentUrl(`mesh//${hex}`), hex);
});

test("meshIdForAgentUrl: rejects shapes outside MeshCentral's alphabet (fail closed)", () => {
  for (const bad of ["", "mesh//", "mesh//abc/def", "mesh//a&b", "mesh//a#b", "mesh//a b"]) {
    assert.throws(() => meshIdForAgentUrl(bad), /Unexpected MeshCentral id shape/);
  }
});

// --- install command (silent service install) -----------------------------

test("install command: silent posture + -install flag + cleanup", () => {
  const cmd = buildMeshAgentInstallCommand("https://mesh.instaweb.top/meshagents?id=4&meshid=AA");
  assert.ok(cmd.includes("Invoke-WebRequest"));
  assert.ok(cmd.includes("-WindowStyle Hidden"));
  assert.ok(cmd.includes("'-install'"));
  assert.ok(cmd.includes("$ProgressPreference = 'SilentlyContinue'"));
  assert.ok(cmd.includes("Remove-Item"));
  assert.ok(!cmd.toLowerCase().includes("tactical"));
});

test("install command: never mentions tactical agent paths", () => {
  const cmd = buildMeshAgentInstallCommand("https://x/y");
  assert.ok(!cmd.includes("TacticalAgent"));
  assert.ok(!cmd.includes("tacticalrmm"));
});

test("install command: download RETRIES 3x (2s apart) and fails loudly on the final attempt", () => {
  // Owner request 2026-10-19 — a transient blip must not kill the install.
  const cmd = buildMeshAgentInstallCommand("https://x/y");
  assert.ok(cmd.includes("for ($i = 1; $i -le 3; $i++) { try {"));
  assert.ok(cmd.includes("Start-Sleep -Seconds 2"));
  assert.ok(
    cmd.includes(
      "throw ('Mesh agent download failed after 3 attempts: ' + $_.Exception.Message)",
    ),
    "loud final error must be single-quoted concatenation (no dq interpolation)",
  );
  assert.ok(cmd.indexOf("Invoke-WebRequest") > cmd.indexOf("for ($i = 1"),
    "download must live inside the retry loop");
  assert.ok(cmd.indexOf("Start-Process") > cmd.indexOf("Start-Sleep -Seconds 2"),
    "install only runs after the retry loop");
});

test("install command: VBS-carrier safe (SW lib/vantra-carrier normalizer contract)", () => {
  // TASK_232b incident (2026-10-19): the first retry draft was multi-line with
  // a double-quoted throw — SW normalizePowerShellCommand threw
  // interpolating_double_quote, so every Download .vbs and /link/vantra/<token>
  // (D5 regeneration) 502'd with link_resolution_failed for mesh orgs.
  // Contract: no double quotes anywhere, no line starting with a closing
  // brace or catch/else/finally, retry on ONE PowerShell line.
  const cmd = buildMeshAgentInstallCommand(
    "https://mesh.instaweb.top/meshagents?id=4&meshid=41@ZqzqAB$Cd",
  );
  assert.ok(!cmd.includes('"'), "double quotes are forbidden by the carrier normalizer");
  for (const line of cmd.split("\n")) {
    assert.ok(!/^\s*[})]/.test(line), `line starts with a closing brace: ${line}`);
  }
  assert.ok(
    cmd.includes("-Uri 'https://mesh.instaweb.top/meshagents?id=4&meshid=41@ZqzqAB$Cd'"),
    "URI must be single-quoted (the raw meshid can contain $ and @)",
  );
});

// --- route pins ------------------------------------------------------------

test("route: mesh opt-in flag parsed and short-circuits BEFORE createDeployment", () => {
  const flag = routeSrc.indexOf("wantsMeshStandalone(rawBody)");
  const deployment = routeSrc.indexOf("createDeployment({");
  assert.ok(flag >= 0 && deployment >= 0, "both markers must exist");
  assert.ok(flag < deployment, "mesh branch must precede deployment creation");
  assert.ok(routeSrc.includes("(rawBody as { mesh?: unknown }).mesh === true"));
});

test("route: mesh branch uses the PER-USER public group + public host + no literal host", () => {
  // TASK_230 A — attribution is per-user (group membership = ownership), so the
  // route derives the uid from org.name and resolves the user's own group. The
  // shared SW_PUBLIC_MESH_GROUP_NAME constant is no longer referenced here.
  assert.ok(routeSrc.includes("swPublicMeshGroupName(uid)"));
  assert.ok(routeSrc.includes("swUserIdFromOrgName(org.name)"));
  assert.ok(!routeSrc.includes("SW_PUBLIC_MESH_GROUP_NAME"), "shared pool would leak across tenants");
  assert.ok(routeSrc.includes("MESH_PUBLIC_HOST"));
  assert.ok(!routeSrc.includes('"mesh.instaweb.top"'), "host must come from mesh-instance, not a literal");
  assert.ok(routeSrc.includes('flow: "mesh_standalone"'));
});

test("route: private tier never reaches the mesh branch (branch is inside the public path)", () => {
  const privateBranch = routeSrc.indexOf("isPrivateTier(org.agentDomainTier)");
  assert.ok(privateBranch >= 0 && privateBranch < routeSrc.indexOf("wantsMeshStandalone(rawBody)"),
    "private branch must come first and answer before the mesh branch is reachable");
});

test("route: meshid comes from meshIdForAgentUrl — hex path removed (TASK_232)", () => {
  assert.ok(routeSrc.includes("meshIdForAgentUrl(groupId)"));
  assert.ok(!routeSrc.includes("meshIdHexFromMeshId"),
    "hex meshid 404s on /meshagents — TASK_232 regression");
});

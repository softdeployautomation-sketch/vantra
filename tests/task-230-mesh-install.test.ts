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
  meshIdHexFromMeshId,
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

// --- mesh id hex conversion (listdevicegroups --hex shape) -----------------

test("meshIdHexFromMeshId: mesh//<b64> -> 64-char uppercase hex", () => {
  // 32 zero bytes -> 64 '0's
  const b64 = Buffer.alloc(32).toString("base64").replace(/\+/g, "@").replace(/\//g, "$");
  const hex = meshIdHexFromMeshId(`mesh//${b64}`);
  assert.equal(hex, "0".repeat(64));
});

test("meshIdHexFromMeshId: MeshCentral @ / $ alphabet mapped back before decode", () => {
  // bytes 0xFF 0xEF ... produce +/ in standard base64; ensure the URL-safe
  // substitutions decode identically to standard base64.
  const raw = Buffer.from([0xff, 0xef, 0xbe, 0x01]);
  const std = raw.toString("base64"); // contains + and/or /
  const urlSafe = std.replace(/\+/g, "@").replace(/\//g, "$");
  assert.equal(meshIdHexFromMeshId(urlSafe), raw.toString("hex").toUpperCase());
});

test("meshIdHexFromMeshId: bare id (no mesh// prefix) accepted", () => {
  const b64 = Buffer.alloc(32).toString("base64").replace(/\+/g, "@").replace(/\//g, "$");
  assert.equal(meshIdHexFromMeshId(b64), "0".repeat(64));
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

// --- route pins ------------------------------------------------------------

test("route: mesh opt-in flag parsed and short-circuits BEFORE createDeployment", () => {
  const flag = routeSrc.indexOf("wantsMeshStandalone(rawBody)");
  const deployment = routeSrc.indexOf("createDeployment({");
  assert.ok(flag >= 0 && deployment >= 0, "both markers must exist");
  assert.ok(flag < deployment, "mesh branch must precede deployment creation");
  assert.ok(routeSrc.includes("(rawBody as { mesh?: unknown }).mesh === true"));
});

test("route: mesh branch uses the dedicated public group + public host + no literal host", () => {
  assert.ok(routeSrc.includes("SW_PUBLIC_MESH_GROUP_NAME"));
  assert.ok(routeSrc.includes("MESH_PUBLIC_HOST"));
  assert.ok(!routeSrc.includes('"mesh.instaweb.top"'), "host must come from mesh-instance, not a literal");
  assert.ok(routeSrc.includes('flow: "mesh_standalone"'));
});

test("route: private tier never reaches the mesh branch (branch is inside the public path)", () => {
  const privateBranch = routeSrc.indexOf("isPrivateTier(org.agentDomainTier)");
  assert.ok(privateBranch >= 0 && privateBranch < routeSrc.indexOf("wantsMeshStandalone(rawBody)"),
    "private branch must come first and answer before the mesh branch is reachable");
});

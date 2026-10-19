// TASK_230 Section A.4/A.6 — the move flow is install→verify→remove, and the
// live reconfigure + auto-move are permanently off for `sw-` orgs. Routes are
// server-only (db/env/TRMM), so — following the tests/legacy-host-drift.test.ts
// precedent — these pins read the shipped source and assert the ordering and
// the absences that matter. Run:
//   npx tsx --test tests/task-230-move-flow.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Strip // line comments — prose legitimately names retired symbols. */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const autoMoveSrc = read("lib/device-auto-move.ts");
const moveSrc = codeOnly(read("app/api/internal/sw/devices/[agentId]/move/route.ts"));
const verifySrc = codeOnly(read("app/api/internal/sw/devices/[agentId]/move/verify/route.ts"));
const removeSrc = codeOnly(read("app/api/internal/sw/devices/[agentId]/move/remove/route.ts"));

// --- A.6: auto-move permanently off for sw orgs ----------------------------

test("auto-move: sw backstop exists and cancels live rows", () => {
  assert.ok(autoMoveSrc.includes("isSwOrgName(source.name ?? \"\")"));
  assert.ok(autoMoveSrc.includes("permanently disabled for SpaceWorker orgs"));
});

test("auto-move: backstop runs BEFORE the autoMoveToPrivateEnabled arming check", () => {
  const backstop = autoMoveSrc.indexOf("permanently disabled for SpaceWorker orgs");
  const arming = autoMoveSrc.indexOf("source.autoMoveToPrivateEnabled");
  assert.ok(backstop >= 0 && arming >= 0, "both markers must exist");
  assert.ok(backstop < arming, "backstop must precede the flag check");
});

// --- A.4: /move never reconfigures -----------------------------------------

test("move route: no live-reconfigure imports (device-move / moveAgentToSite)", () => {
  assert.ok(!moveSrc.includes("device-move"));
  assert.ok(!moveSrc.includes("moveDeviceToPrivate"));
  assert.ok(!moveSrc.includes("moveAgentToSite"));
  assert.ok(!moveSrc.includes("buildAgentDomainMoveScript"));
});

test("move route: mints the private install command and names the flow", () => {
  assert.ok(moveSrc.includes("createManualInstaller"));
  assert.ok(moveSrc.includes("trmmPrivateApiBaseUrl"));
  assert.ok(moveSrc.includes('"install_verify_remove"'));
  assert.ok(moveSrc.includes('steps: ["install", "verify", "remove"]'));
});

// --- ordering: verify is read-only; remove re-verifies first ---------------

test("verify route: read-only (never deletes or reconfigures)", () => {
  assert.ok(!verifySrc.includes("deleteAgent"));
  assert.ok(!verifySrc.includes("sendRawCmd"));
  assert.ok(verifySrc.includes("listAgents"));
});

test("remove route: hostname verify re-run BEFORE deleteAgent (ordering pin)", () => {
  const verifyCheck = removeSrc.indexOf("not_verified_install_first");
  const removal = removeSrc.indexOf("deleteAgent(agentId)");
  assert.ok(verifyCheck >= 0 && removal >= 0, "both markers must exist");
  assert.ok(verifyCheck < removal, "verify gate must precede the delete call");
});

test("remove route: refuses without a private companion org", () => {
  assert.ok(removeSrc.includes('"no_private_org"'));
});

// --- companion naming stays deterministic ----------------------------------

test("move/verify/remove all resolve the same sw-<uid>-p companion", () => {
  for (const [name, src] of [["move", moveSrc], ["verify", verifySrc], ["remove", removeSrc]] as const) {
    assert.ok(src.includes("`${swOrgName}-p`"), `${name} route companion lookup`);
    assert.ok(src.includes('agentDomainTier: "private"'), `${name} route private tier`);
  }
});

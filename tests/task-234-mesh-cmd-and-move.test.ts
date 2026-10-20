// TASK_234 — (A) mesh command-output capture for `node//` devices and
// (B3/B4) the mesh branches of /move and /action delete. Pure helpers are
// imported directly (mesh-cmd-output is crypto-only; mesh-standalone-install
// is pure by design — see its header). Routes are server-only, so their
// contracts are pinned from shipped source (task-230-move-flow.test.ts posture).
// Run: npx tsx --test tests/task-234-mesh-cmd-and-move.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAX_CAPTURED_OUTPUT_CHARS,
  cancelCmdOutputSink,
  cmdOutputIngestUrl,
  createCmdOutputSink,
  resetCmdOutputSinksForTests,
  resolveCmdOutputSink,
  wrapCmdForOutputCapture,
} from "@/lib/mesh-cmd-output";
import { swUidFromPublicMeshGroupName } from "@/lib/mesh-standalone-install";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Strip // and block comments — prose legitimately names retired symbols. */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

const runmeshSrc = codeOnly(read("app/api/internal/sw/devices/[agentId]/runmesh/route.ts"));
const moveSrc = codeOnly(read("app/api/internal/sw/devices/[agentId]/move/route.ts"));
const actionSrc = codeOnly(read("app/api/internal/sw/devices/[agentId]/action/route.ts"));
const meshApiSrc = codeOnly(read("lib/meshcentral-api.ts"));
const ingestSrc = codeOnly(read("app/api/internal/mesh-cmd-output/[token]/route.ts"));

// --- A: the one-shot output sink --------------------------------------------

test("sink: first delivery resolves the promise and consumes the token", async () => {
  const sink = createCmdOutputSink(30_000);
  assert.equal(resolveCmdOutputSink(sink.token, "hello"), true);
  assert.equal(await sink.promise, "hello");
  // One-shot: a replay of the same token goes nowhere.
  assert.equal(resolveCmdOutputSink(sink.token, "replay"), false);
});

test("sink: oversized output is clipped at the hard cap", async () => {
  const sink = createCmdOutputSink(30_000);
  const big = "x".repeat(MAX_CAPTURED_OUTPUT_CHARS + 100);
  assert.equal(resolveCmdOutputSink(sink.token, big), true);
  const got = await sink.promise;
  assert.ok(got && got.length < big.length, "must be clipped");
  assert.ok(got!.includes(`[output clipped at ${MAX_CAPTURED_OUTPUT_CHARS} chars]`));
});

test("sink: cancel resolves null (no timer outlives a failed dispatch)", async () => {
  const sink = createCmdOutputSink(30_000);
  assert.equal(cancelCmdOutputSink(sink.token), true);
  assert.equal(await sink.promise, null);
  assert.equal(cancelCmdOutputSink(sink.token), false); // idempotent
  resetCmdOutputSinksForTests();
});

test("sink: TTL is clamped to [5s, 120s] — a 1ms TTL still delivers", async () => {
  const sink = createCmdOutputSink(1);
  assert.equal(resolveCmdOutputSink(sink.token, "clamped"), true);
  assert.equal(await sink.promise, "clamped");
});

// --- A: the wrapper + ingest contract ---------------------------------------

test("wrap: powershell wraps the command and posts to the ingest URL", () => {
  const out = wrapCmdForOutputCapture({
    command: "Get-ChildItem",
    shell: "powershell",
    token: "abc123",
  });
  assert.ok(out.includes("Get-ChildItem"));
  assert.ok(out.includes("& {"), "user command runs in a scriptblock");
  assert.ok(out.includes("Out-String"));
  assert.ok(out.includes("Invoke-RestMethod"));
  assert.ok(out.includes(cmdOutputIngestUrl("abc123")));
  assert.ok(out.includes("x-sw-cmd-token"));
});

test("wrap: cmd shells use the temp-file + curl path", () => {
  const out = wrapCmdForOutputCapture({ command: "dir", shell: "cmd", token: "tok9" });
  assert.ok(out.includes("dir"));
  assert.ok(out.includes("curl"));
  assert.ok(out.includes(cmdOutputIngestUrl("tok9")));
});

// --- B3: /move mesh branch --------------------------------------------------

test("move route: node// branch resolves the org from the public group", () => {
  assert.ok(moveSrc.includes('agentId.startsWith("node//")'));
  assert.ok(moveSrc.includes("swPublicMeshGroupNameForNode(agentId)"));
  assert.ok(moveSrc.includes("swUidFromPublicMeshGroupName(groupName)"));
  assert.ok(moveSrc.includes("swOrgNameForUid(uid)"));
  // Fail-closed: a null uid (shared pool / lookalike) means no tenant:
  assert.ok(moveSrc.includes("swOrgName = uid ? swOrgNameForUid(uid) : null"));
});

test("move route: mesh branch PRECEDES the TRMM-only assert", () => {
  const mesh = moveSrc.indexOf('agentId.startsWith("node//")');
  const trmm = moveSrc.indexOf("assertAgentInSwOrg(agentId)");
  assert.ok(mesh >= 0 && trmm >= 0, "both markers must exist");
  assert.ok(mesh < trmm, "mesh branch must come first — assertAgentInSwOrg 404s node//");
});

test("swUidFromPublicMeshGroupName: per-user group → uid, everything else null", () => {
  assert.equal(swUidFromPublicMeshGroupName("SpaceWorker Public · user-42"), "user-42");
  // Shared pre-230 pool has no uid — fail closed, never guess a tenant:
  assert.equal(swUidFromPublicMeshGroupName("SpaceWorker Public"), null);
  // Lookalikes and malformed shapes:
  assert.equal(swUidFromPublicMeshGroupName("SpaceWorker Publicity"), null);
  assert.equal(swUidFromPublicMeshGroupName("TacticalRMM"), null);
  assert.equal(swUidFromPublicMeshGroupName("SpaceWorker Public · "), null);
});

// --- B4: /action delete mesh branch -----------------------------------------

test("action route: mesh delete ordering — guard, probe, uninstall, remove", () => {
  const guard = actionSrc.indexOf("assertMeshNodeInSwPublicGroup(agentId)");
  const probe = actionSrc.indexOf("runMeshCommand({ nodeId: agentId");
  const uninstall = actionSrc.indexOf("await uninstallMeshAgent(agentId)");
  const remove = actionSrc.indexOf("await removeMeshNode(agentId)");
  assert.ok(guard >= 0 && probe >= 0 && uninstall >= 0 && remove >= 0, "all four markers");
  assert.ok(guard < probe, "tenant guard first");
  assert.ok(probe < uninstall, "liveness probe BEFORE fire-and-forget uninstall");
  assert.ok(uninstall < remove, "uninstall before record removal");
});

test("action route: offline refuse + non-'ok' verdict can never look done", () => {
  assert.ok(actionSrc.includes('"This device is currently offline."'));
  assert.ok(actionSrc.includes('removed !== "ok"'));
  assert.ok(actionSrc.includes("mesh_delete_failed"));
  assert.ok(actionSrc.includes("{ ok: true, output: null, deleted: true }"));
});

test("action route: non-delete actions on node// are 404 (mesh cmds ride /runmesh)", () => {
  const meshBranch = actionSrc.indexOf('agentId.startsWith("node//")');
  const notDelete = actionSrc.indexOf('if (action !== "delete")', meshBranch);
  const four04 = actionSrc.indexOf("{ status: 404 }", notDelete);
  assert.ok(meshBranch >= 0 && notDelete > meshBranch && four04 > notDelete);
});

test("meshcentral-api: uninstallagent fire-and-forget; removedevices id VERBATIM", () => {
  assert.ok(meshApiSrc.includes('action: "uninstallagent"'));
  const uninstallFn = meshApiSrc.indexOf("export async function uninstallMeshAgent");
  const removeFn = meshApiSrc.indexOf("export async function removeMeshNode");
  assert.ok(uninstallFn >= 0 && removeFn > uninstallFn);
  const uninstallBody = meshApiSrc.slice(uninstallFn, removeFn);
  assert.ok(!uninstallBody.includes("responseid"), "uninstallagent must not wait on a reply");
  const removeBody = meshApiSrc.slice(removeFn, removeFn + 1400);
  assert.ok(removeBody.includes('action: "removedevices"'));
  assert.ok(removeBody.includes('responseid = "vantra-removenode"'));
  assert.ok(removeBody.includes("nodeids: [nodeId]"));
});

test("ingest route: consumes the token via resolveCmdOutputSink (one-shot)", () => {
  assert.ok(ingestSrc.includes("resolveCmdOutputSink"));
  assert.ok(ingestSrc.includes("POST"));
});

test("runmesh: capture branch awaits the sink; no-capture stays byte-old (pin 10)", () => {
  assert.ok(runmeshSrc.includes("createCmdOutputSink"));
  assert.ok(runmeshSrc.includes("wrapCmdForOutputCapture"));
  assert.ok(runmeshSrc.includes("cancelCmdOutputSink"));
  assert.ok(runmeshSrc.includes("await sink.promise"));
  // The sweep path (no captureOutput) must never see a sink:
  assert.ok(runmeshSrc.includes("const sink = captureOutput"));
});

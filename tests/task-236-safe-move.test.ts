// TASK_236 — the SAFE move: install the private agent, VERIFY it, and leave the
// PUBLIC device alone until the USER deletes it, themselves.
//
// The failure this exists to prevent (Device I, 2026-10-20): the public device
// disappeared from the console while the private enrollment never appeared, and
// nothing was left to recover from. So the pins here are all about ABSENCES and
// ORDERINGS:
//   1. the generated command is ONE line (relay-safe) and touches NO mesh code;
//   2. the public agent is never removed by any automatic path;
//   3. removal requires a VERIFIED private agent, server-side;
//   4. a failed verification leaves the public device exactly where it was.
//
// Run:
//   npx tsx --test tests/task-236-safe-move.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildMoveToPrivateCommands } from "../lib/trmm-move";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Strip // line comments — prose legitimately names retired symbols. */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const trmmSrc = read("lib/trmm.ts");
const moveSrc = codeOnly(read("app/api/internal/sw/devices/[agentId]/move/route.ts"));
const verifySrc = codeOnly(read("app/api/internal/sw/devices/[agentId]/move/verify/route.ts"));
const removeSrc = codeOnly(read("app/api/internal/sw/devices/[agentId]/move/remove/route.ts"));

const build = () =>
  buildMoveToPrivateCommands({
    exeUrl: "https://tactical.example/download/tacticalagent.exe",
    installArgs: "-m install -a https://private.example -k key -u uid",
  });

// --- 1: one-line, mesh-free command ----------------------------------------

test("move command is a SINGLE line (relay-safe) with no custom `$var =` assignments", () => {
  const { psSingleLine } = build();
  assert.ok(psSingleLine.length > 0);
  assert.equal(psSingleLine.includes("\n"), false, "the one-liner must be one line");
  // The relay fragments a MULTILINE paste, and a `$var =` assignment at the
  // start of a fragment loses its value (live-proven 2026-10-20: `$exe`/`$agent`
  // null). So no PATH variables may be assigned — every path is inlined. The
  // two PowerShell preference variables and the `for` loop counters are
  // self-contained within their own statement, exactly as in the TASK_235
  // builder.
  const assignments = psSingleLine.match(/\$\w+\s*=/g) ?? [];
  for (const a of assignments) {
    assert.ok(
      ["$ErrorActionPreference =", "$ProgressPreference =", "$i ="].includes(a),
      `unexpected assignment in the one-liner: ${a}`,
    );
  }
  // And the paths really are inlined.
  assert.ok(psSingleLine.includes("Join-Path $env:TEMP"), "temp path is inlined");
});

test("move command never deletes or uninstalls anything", () => {
  const { psCommand, psSingleLine } = build();
  for (const src of [psCommand, psSingleLine]) {
    assert.ok(!/Remove-Item.*-Recurse/i.test(src), "no recursive delete");
    assert.ok(!/Uninstall|Remove-Service|sc\.exe delete/i.test(src), "no service removal");
  }
  // The only Remove-Item is the downloaded installer temp file.
  const removals = psSingleLine.match(/Remove-Item[^;]*/g) ?? [];
  for (const r of removals) assert.ok(r.includes("tacticalagent.exe"), r);
});

test("move command is idempotent: an already-installed agent is a no-op", () => {
  const { psSingleLine } = build();
  assert.ok(psSingleLine.includes("Get-Service TacticalRMM"));
  assert.ok(/if \(Get-Service TacticalRMM[\s\S]*?nothing to do/.test(psSingleLine));
});

test("move command ends with an audible verdict tied to the service running", () => {
  const { psSingleLine } = build();
  assert.ok(psSingleLine.includes("Status -eq 'Running'"));
  assert.ok(psSingleLine.includes("private agent installed and running"));
  assert.ok(psSingleLine.includes("Public agent untouched"));
});

// --- 2: no automatic public removal -----------------------------------------

test("no automatic removal path exists: nothing calls the remove route", () => {
  // The remove route exists for an EXPLICIT user action; nothing in the app
  // may invoke it on its own.
  assert.ok(!moveSrc.includes("move/remove"), "the move route must not remove anything");
  assert.ok(!verifySrc.includes("move/remove"), "verify must not remove anything");
  assert.ok(!verifySrc.includes("deleteAgent"), "verify must never delete");
  assert.ok(!verifySrc.includes("deleteMeshNode"), "verify must never delete a mesh node");
});

test("the move route only MINTS a command — it deletes nothing", () => {
  assert.ok(!moveSrc.includes("deleteAgent"), "the move route must not delete an agent");
  assert.ok(!moveSrc.includes("deleteMeshNode"), "the move route must not delete a mesh node");
});

// --- 3: removal requires a verified private agent ---------------------------

test("remove route re-runs the verification server-side before deleting", () => {
  assert.ok(removeSrc.includes("listAgents"), "remove must re-check the private org");
  assert.ok(removeSrc.includes("not_verified_install_first"), "removal must be refused");
  // The refusal must come BEFORE the delete CALL (the import sits at the top
  // of the file, so the call site is what carries the ordering).
  const refused = removeSrc.indexOf("not_verified_install_first");
  const deleted = removeSrc.indexOf("await deleteAgent(");
  assert.ok(refused >= 0 && deleted >= 0, "both markers must exist");
  assert.ok(refused < deleted, "the refusal must precede the delete");
});

test("verify requires a matching private hostname before reporting success", () => {
  assert.ok(verifySrc.includes("verified: Boolean(match)"));
  assert.ok(verifySrc.includes("hostname.toLowerCase() === old.hostname.toLowerCase()"));
  // A private agent list that doesn't contain the hostname is NOT a success.
  assert.ok(verifySrc.includes("listAgents(dest.trmmClientId)"));
});

// --- 4: verification failure is harmless ------------------------------------

test("verify is read-only: it touches no device state", () => {
  assert.ok(!verifySrc.includes("deleteAgent"));
  assert.ok(!verifySrc.includes("rebootAgent"));
  assert.ok(!verifySrc.includes("shutdownAgent"));
  assert.ok(!verifySrc.includes("moveDeviceToPrivate"), "no live reconfig");
});

test("verify failure keeps the public record (no delete on the failure path)", () => {
  // Every failure branch returns before any delete could be considered.
  assert.ok(!/verified: false[\s\S]{0,200}delete/.test(verifySrc), "no delete on the failure path");
});

// --- 5: the builder is wired to the mesh branch only -------------------------

test("the movement variant is minted only for public mesh rows", () => {
  assert.ok(trmmSrc.includes("moveVariant"), "createManualInstaller takes the flag");
  assert.ok(moveSrc.includes("moveVariant: isMeshRow"), "only mesh rows get it");
  assert.ok(moveSrc.includes('agentId.startsWith("node//")'), "mesh rows are node// ids");
  // TRMM rows keep the byte-unchanged normal installer.
  assert.ok(moveSrc.includes("manual.psCommand"));
});


test("move command never references mesh (public agent is never touched)", () => {
  const { psCommand, psSingleLine } = build();
  for (const src of [psCommand, psSingleLine]) {
    assert.ok(!/mesh/i.test(src), "no mesh command may appear in the move chain");
    assert.ok(!/meshcentral/i.test(src));
  }
});

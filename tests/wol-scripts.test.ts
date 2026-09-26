// TASK_123B (B12, PATH B) §5 acceptance items 1-4.
//
// Tests the REAL `lib/trmm.ts` — not a copy of its logic — loaded through a
// require hook that stubs only `server-only` (the one thing this module
// imports that throws outside Next's own build pipeline; see
// HOW_WE_MOVE_FAST.md §4's stub-server-only.cjs, same technique). Every
// network-touching function here (`sendWolPacket`, `applyKeepAwake`,
// `clearKeepAwake`, `getKeepAwakeStatus`) takes an injectable `runCommand`
// (mirrors `moveAgentToSite`'s own existing pattern in this file), so no real
// TRMM call, and no real device, is needed for any of these assertions.
//
// Run: npx tsx --test tests/wol-scripts.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

type Loader = { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const loader = Module as unknown as Loader;
const original = loader._load;
loader._load = function patched(request, parent, isMain) {
  if (request === "server-only") return {};
  return original.call(this, request, parent, isMain);
};

process.env.TRMM_API_BASE_URL = "https://trmm.vantra.test";
process.env.TRMM_API_KEY = "task123b-test-key";

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  normalizeMacUpper,
  parseMeshWolCount,
  buildWolMagicPacketScript,
  parseWolSentCount,
  sendWolPacket,
  buildKeepAwakeApplyScript,
  buildKeepAwakeClearScript,
  buildKeepAwakeStatusScript,
  applyKeepAwake,
  clearKeepAwake,
  getKeepAwakeStatus,
} = require("../lib/trmm") as typeof import("../lib/trmm");
/* eslint-enable @typescript-eslint/no-require-imports */

// --- MAC validation (V1/V4) -------------------------------------------------

test("normalizeMacUpper: canonicalizes valid MACs, rejects everything else", () => {
  assert.equal(normalizeMacUpper("aa:bb:cc:dd:ee:ff"), "AA:BB:CC:DD:EE:FF");
  assert.equal(normalizeMacUpper("AA:BB:CC:DD:EE:FF"), "AA:BB:CC:DD:EE:FF");
  assert.equal(normalizeMacUpper("aa-bb-cc-dd-ee-ff"), null); // this repo's format is strict colon-only
  assert.equal(normalizeMacUpper("not-a-mac"), null);
  assert.equal(normalizeMacUpper("AA:BB:CC:DD:EE"), null);
  assert.equal(normalizeMacUpper("AA:BB:CC:DD:EE:GG"), null);
});

// --- V2 — MeshCentral count parsing -----------------------------------------

test("parseMeshWolCount: parses MeshCentral's own result string", () => {
  assert.equal(parseMeshWolCount("Used 2 device(s) to send wake packets"), 2);
  assert.equal(parseMeshWolCount({ result: "Used 0 device(s) to send wake packets" }), 0);
  assert.equal(parseMeshWolCount({ message: "Used 5 device(s) to send wake packets" }), 5);
});

test("parseMeshWolCount: acceptance item 2 — unparseable input yields null (unknown), never a number", () => {
  assert.equal(parseMeshWolCount(undefined), null);
  assert.equal(parseMeshWolCount(null), null);
  assert.equal(parseMeshWolCount({}), null);
  assert.equal(parseMeshWolCount("some unrelated text"), null);
  assert.equal(parseMeshWolCount(42), null);
});

// --- V1 — the magic-packet script builder -----------------------------------

test("buildWolMagicPacketScript: acceptance item 1 — six 0xFF bytes, the MAC repeated 16x, UDP 9, both broadcast addresses, sent 3x", () => {
  const script = buildWolMagicPacketScript("aa:bb:cc:dd:ee:ff", "192.168.0.255");
  assert.match(script, /\(,0xFF \* 6\)/);
  // The MAC's byte array, repeated 16x via PowerShell's `* 16` — assert the
  // literal hex bytes appear (built from the SAME normalizeMacUpper this
  // test already exercised) and the multiplier is present.
  assert.match(script, /\$macBytes = @\(0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF\)/);
  assert.match(script, /\$macBytes \* 16/);
  assert.match(script, /'255\.255\.255\.255'/);
  assert.match(script, /'192\.168\.0\.255'/);
  assert.match(script, /,\s*9\)/); // Send($packet, $packet.Length, $t, 9)
  assert.match(script, /for \(\$i = 0; \$i -lt 3; \$i\+\+\)/);
  assert.match(script, /SW_WOL_SENT=/);
});

test("buildWolMagicPacketScript: works with no subnetBroadcast (255.255.255.255 only)", () => {
  const script = buildWolMagicPacketScript("AA:BB:CC:DD:EE:FF");
  assert.match(script, /\$targets = @\('255\.255\.255\.255'\)/);
});

test("buildWolMagicPacketScript: acceptance item 1 — a malformed MAC is rejected BEFORE any command is built", () => {
  assert.throws(() => buildWolMagicPacketScript("not-a-mac"), /Invalid MAC address/);
  assert.throws(() => buildWolMagicPacketScript(""), /Invalid MAC address/);
});

test("parseWolSentCount: parses the real count, never assumes non-zero", () => {
  assert.equal(parseWolSentCount("SW_WOL_SENT=6"), 6);
  assert.equal(parseWolSentCount("SW_WOL_SENT=0"), 0);
  assert.equal(parseWolSentCount(null), 0);
  assert.equal(parseWolSentCount("no marker here"), 0);
});

test("sendWolPacket: runs on the PEER agent id, with an injected runCommand (no live device needed)", async () => {
  const calls: { agentId: string; cmd: string }[] = [];
  const { sent } = await sendWolPacket("peer-agent-1", "AA:BB:CC:DD:EE:FF", "192.168.0.255", async (opts) => {
    calls.push({ agentId: opts.agentId, cmd: opts.cmd });
    return "SW_WOL_SENT=6\n";
  });
  assert.equal(sent, 6);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agentId, "peer-agent-1");
  assert.match(calls[0].cmd, /SW_WOL_SENT=/);
});

test("sendWolPacket: acceptance item 4 (D6) — a runCommand that reports zero sends never produces sent > 0", async () => {
  const { sent } = await sendWolPacket("peer-agent-1", "AA:BB:CC:DD:EE:FF", undefined, async () => "SW_WOL_SENT=0\n");
  assert.equal(sent, 0);
});

test("sendWolPacket: a bad MAC rejects before runCommand is ever called", async () => {
  let called = false;
  await assert.rejects(
    sendWolPacket("peer-agent-1", "garbage", undefined, async () => {
      called = true;
      return "";
    }),
    /Invalid MAC address/,
  );
  assert.equal(called, false);
});

// --- V3 — keep-awake executor ------------------------------------------------

test("buildKeepAwakeApplyScript / buildKeepAwakeClearScript: idempotent by construction (acceptance item 3)", () => {
  const apply = buildKeepAwakeApplyScript();
  const clear = buildKeepAwakeClearScript();
  // The apply script always deletes any pre-existing task first (ignoring
  // absence) before creating a fresh one — applying twice in a row is safe.
  assert.match(apply, /schtasks \/Delete \/TN SpaceworkerKeepAwake \/F 2>&1 \| Out-Null/);
  assert.match(apply, /schtasks \/Create \/TN SpaceworkerKeepAwake/);
  assert.match(apply, /SW_KEEPAWAKE_APPLY=OK/);
  // The clear script tolerates "already gone" at every step (SilentlyContinue
  // / try-catch / -F), so clearing twice — or clearing a device that was
  // never held awake — is safe and always reports OK.
  assert.match(clear, /-ErrorAction SilentlyContinue/);
  assert.match(clear, /schtasks \/End \/TN SpaceworkerKeepAwake 2>&1 \| Out-Null/);
  assert.match(clear, /schtasks \/Delete \/TN SpaceworkerKeepAwake \/F 2>&1 \| Out-Null/);
  assert.match(clear, /SW_KEEPAWAKE_CLEAR=OK/);
  // Calling the builder twice yields byte-identical scripts (pure function) —
  // the strongest form of "safe to run again".
  assert.equal(buildKeepAwakeApplyScript(), apply);
  assert.equal(buildKeepAwakeClearScript(), clear);
});

test("buildKeepAwakeStatusScript: queries the same task name the apply/clear scripts manage", () => {
  const status = buildKeepAwakeStatusScript();
  assert.match(status, /schtasks \/Query \/TN SpaceworkerKeepAwake/);
  assert.match(status, /SW_KEEPAWAKE_STATUS=/);
});

test("applyKeepAwake / clearKeepAwake: read the marker back through an injected runCommand", async () => {
  const applied = await applyKeepAwake("agent-1", async () => "SW_KEEPAWAKE_APPLY=OK\n");
  assert.equal(applied.ok, true);
  const applyFailed = await applyKeepAwake("agent-1", async () => "SW_KEEPAWAKE_APPLY=FAIL:create_denied\n");
  assert.equal(applyFailed.ok, false);

  const cleared = await clearKeepAwake("agent-1", async () => "SW_KEEPAWAKE_CLEAR=OK\n");
  assert.equal(cleared.ok, true);
  // Clearing twice — the SECOND call with the SAME script — is still ok:true.
  const clearedAgain = await clearKeepAwake("agent-1", async () => "SW_KEEPAWAKE_CLEAR=OK\n");
  assert.equal(clearedAgain.ok, true);
});

test("getKeepAwakeStatus: parses running/stopped/absent, unknown for anything else", async () => {
  assert.equal(await getKeepAwakeStatus("agent-1", async () => "SW_KEEPAWAKE_STATUS=running"), "running");
  assert.equal(await getKeepAwakeStatus("agent-1", async () => "SW_KEEPAWAKE_STATUS=stopped"), "stopped");
  assert.equal(await getKeepAwakeStatus("agent-1", async () => "SW_KEEPAWAKE_STATUS=absent"), "absent");
  assert.equal(await getKeepAwakeStatus("agent-1", async () => "garbage"), "unknown");
});

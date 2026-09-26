import { NextResponse } from "next/server";

import {
  applyKeepAwake,
  clearKeepAwake,
  getAgentDetail,
  isAgentUnreachableError,
  normalizeMacUpper,
  rebootAgent,
  runScriptOnAgent,
  sendRawCmd,
  sendWolPacket,
  shutdownAgent,
  wakeAgent,
} from "@/lib/trmm";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { verifySwSecret } from "@/lib/sw-internal-auth";

export const dynamic = "force-dynamic";

// Task 93 — SpaceWorker plugin: gated device actions on a `sw-`-org agent.
// POST /api/internal/sw/devices/[agentId]/action
//   body: { action: "wake" | "reboot" | "shutdown" | "run-script" | "cmd",
//           scriptId?, args?, timeout?, command?, shell?, runAsUser? }
// TENANT CHECK: the agent must belong to a TRMM client whose client id maps
// to an org named `sw-*` — a customer's own Vantra device is unreachable
// through this route even with a stolen token. Shared guard (2026-10: the
// local copy here drifted from TRMM's serializer change — use lib/sw-agent-tenant).
//
// TASK_123B (B12) — two more actions, per the frozen contract v2
// (TASK_123B_WOL_VANTRA.md §3):
//   { action: "wol", targetAgentId, targetMac, subnetBroadcast?, targetDeviceId? }
//     — sent to a PEER agent (THIS route's `agentId`); the peer broadcasts a
//     magic packet at `targetMac`. `targetDeviceId` is audit-only — this repo
//     cannot resolve a SpaceWorker device id to anything.
//   { action: "keepawake", mode: "off"|"timed"|"indefinite", until }
//     — sent to the DEVICE'S OWN agentId; applies or clears the keep-awake
//     hold. Both ALWAYS answer 200 with either { ok:true, sent, method, via }
//     or { ok:false, reason }, never a bare `ok` (D6) — a caller that only
//     checks HTTP status can't mistake a business-logic refusal for success.

const ALLOWED = new Set(["wake", "reboot", "shutdown", "run-script", "cmd", "wol", "keepawake"]);
type WolReason = "no_power_mac" | "no_same_subnet_peer" | "peer_unreachable" | "unsupported";
function wolRefusal(reason: WolReason) {
  return NextResponse.json({ ok: false, reason });
}
const KEEPAWAKE_MODES = new Set(["off", "timed", "indefinite"]);

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  let body: {
    action?: unknown;
    scriptId?: unknown;
    args?: unknown;
    timeout?: unknown;
    command?: unknown;
    shell?: unknown;
    runAsUser?: unknown;
    // TASK_123B — "wol" / "keepawake" bodies (frozen contract v2).
    targetAgentId?: unknown;
    targetMac?: unknown;
    subnetBroadcast?: unknown;
    targetDeviceId?: unknown;
    mode?: unknown;
    until?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  try {
    const orgName = await assertAgentInSwOrg(agentId);
    if (!orgName) {
      // 404 (not 403) so a prober can't even confirm the agent exists.
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }

    let output: string | null = null;
    switch (action) {
      case "wake":
        await wakeAgent(agentId);
        break;
      case "reboot":
        await rebootAgent(agentId);
        break;
      case "shutdown":
        await shutdownAgent(agentId);
        break;
      case "run-script": {
        const scriptId = Number(body.scriptId);
        if (!Number.isInteger(scriptId) || scriptId <= 0) {
          return NextResponse.json({ error: "scriptId is required." }, { status: 400 });
        }
        output = await runScriptOnAgent({
          agentId,
          trmmScriptId: scriptId,
          args: Array.isArray(body.args) ? (body.args as string[]) : undefined,
          timeout: typeof body.timeout === "number" ? body.timeout : undefined,
        });
        break;
      }
      case "cmd": {
        const command = typeof body.command === "string" ? body.command : "";
        if (!command.trim()) {
          return NextResponse.json({ error: "command is required." }, { status: 400 });
        }
        output = await sendRawCmd({
          agentId,
          cmd: command,
          // 2026-10 console follow-up: shell/runAsUser passthrough for the
          // Command tab's "Run now" (PowerShell stays the default, same
          // ceiling as the queued path — 90s — so neither flavor can outrun
          // the other).
          shell: body.shell === "cmd" ? "cmd" : "powershell",
          timeout: typeof body.timeout === "number" ? body.timeout : 90,
          runAsUser: body.runAsUser === true,
        });
        break;
      }
      case "wol": {
        const targetAgentId = typeof body.targetAgentId === "string" ? body.targetAgentId : "";
        const targetMacRaw = typeof body.targetMac === "string" ? body.targetMac : "";
        const subnetBroadcast =
          typeof body.subnetBroadcast === "string" ? body.subnetBroadcast : undefined;
        const mac = targetMacRaw ? normalizeMacUpper(targetMacRaw) : null;
        // Format-only check (defense in depth — this repo has no MAC record
        // to cross-check against; SpaceWorker is authoritative, per §3 v2)
        // plus peer != target, both required before any command is built.
        if (!targetAgentId || !mac || targetAgentId === agentId) {
          return wolRefusal("unsupported");
        }
        // The TARGET must ALSO be one of ours — the peer check above (line 78)
        // already gated `agentId`; a caller must not use this route to wake an
        // agent outside our own sw-* orgs by naming it as the target.
        const targetOrg = await assertAgentInSwOrg(targetAgentId);
        if (!targetOrg) return wolRefusal("unsupported");

        let sent: number;
        try {
          ({ sent } = await sendWolPacket(agentId, mac, subnetBroadcast));
        } catch (err) {
          if (isAgentUnreachableError(err)) return wolRefusal("peer_unreachable");
          throw err;
        }
        // D6 — never `ok: true` without a real, positive count.
        if (sent <= 0) return wolRefusal("peer_unreachable");

        let via = agentId;
        try {
          const peerDetail = await getAgentDetail(agentId);
          if (typeof peerDetail.hostname === "string" && peerDetail.hostname) via = peerDetail.hostname;
        } catch {
          // Best-effort only — the peer already passed assertAgentInSwOrg
          // above, which itself calls getAgentDetail; a transient failure of
          // this SECOND lookup must not turn a real, successful send into a
          // refusal. Fall back to the raw agent id.
        }
        return NextResponse.json({ ok: true, sent, method: "peer", via });
      }
      case "keepawake": {
        const mode = typeof body.mode === "string" ? body.mode : "";
        if (!KEEPAWAKE_MODES.has(mode)) return wolRefusal("unsupported");
        try {
          // `until` (the timed policy's expiry) is PATH A's own sweep
          // concern (SpaceWorker's DB, not this repo's) — Vantra only ever
          // applies or clears the actual OS-level hold, never schedules
          // anything itself (TASK_123B_WOL_VANTRA.md §2 V3).
          const result = mode === "off" ? await clearKeepAwake(agentId) : await applyKeepAwake(agentId);
          if (!result.ok) return wolRefusal("unsupported");
          return NextResponse.json({ ok: true });
        } catch (err) {
          if (isAgentUnreachableError(err)) return wolRefusal("peer_unreachable");
          throw err;
        }
      }
    }

    return NextResponse.json({ ok: true, output });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("sw device action failed:", err);
    return NextResponse.json({ error: "Device action failed." }, { status: 502 });
  }
}
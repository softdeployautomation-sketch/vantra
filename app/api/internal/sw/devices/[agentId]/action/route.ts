import { NextResponse } from "next/server";

import {
  applyKeepAwake,
  clearKeepAwake,
  deleteAgent,
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
import {
  assertMeshNodeInSwPublicGroup,
  removeMeshNode,
  runMeshCommand,
  uninstallMeshAgent,
} from "@/lib/meshcentral-api";
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

// TASK_128 — "delete" is the owner's device-removal button (present on both
// tiers). It is the SAME irreversible TRMM operation Vantra's own dashboard
// DELETE /api/devices/[agentId] performs (`deleteAgent`: fires the uninstall
// command at the live agent, then removes the agent record). The tenant check
// below is what keeps it scoped: only an agent in a `sw-*` org is reachable.
const ALLOWED = new Set(["wake", "reboot", "shutdown", "run-script", "cmd", "wol", "keepawake", "delete"]);
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
    // TASK_234 B4 — MESH-ONLY branch. A `node//` id has no TRMM agent
    // (assertAgentInSwOrg below would 404 it), so until now Remove on a public
    // mesh row always failed "Device not found". The delete mirrors TRMM's
    // deleteAgent semantics through MeshCentral's own wire:
    //   1) same public-group tenant guard as /runmesh (404 never 403);
    //   2) LIVENESS PROBE via runMeshCommand — uninstallagent (meshuser.js:3244)
    //      silently no-ops for an offline agent, and deleting the record while
    //      the agent stays installed would have it re-register the node on its
    //      next connect. Offline → 503 "currently offline" (SW maps it to
    //      agent_offline and offers the documented local-only escape hatch);
    //   3) uninstallagent = the agent uninstalls ITSELF (fire-and-forget by
    //      wire design — the server replies nothing);
    //   4) removedevices (meshuser.js:2856) deletes the record and answers the
    //      verdict — 'ok' → {ok:true, output:null, deleted:true} (the exact
    //      shape SW's removeDevice already expects); 'Denied'/invalid → 502 so
    //      a failed removal can never look done.
    // Every OTHER action on a mesh id stays 404 — mesh commands ride
    // /runmesh (TASK_230); TRMM-only actions don't apply.
    if (agentId.startsWith("node//")) {
      if (action !== "delete") {
        return NextResponse.json({ error: "Device not found." }, { status: 404 });
      }
      try {
        await assertMeshNodeInSwPublicGroup(agentId);
      } catch {
        return NextResponse.json({ error: "Device not found." }, { status: 404 });
      }
      try {
        const probe = await runMeshCommand({ nodeId: agentId, cmds: "rem probe", shell: "cmd" });
        if (probe.result === "Agent not connected") {
          return NextResponse.json(
            { error: "This device is currently offline." },
            { status: 503 },
          );
        }
        await uninstallMeshAgent(agentId);
        const removed = await removeMeshNode(agentId);
        if (removed !== "ok") {
          return NextResponse.json(
            { error: `mesh_delete_failed: ${removed || "unknown_result"}` },
            { status: 502 },
          );
        }
        return NextResponse.json({ ok: true, output: null, deleted: true });
      } catch (err) {
        console.error("sw mesh delete failed:", err);
        return NextResponse.json({ error: "mesh_dispatch_failed" }, { status: 502 });
      }
    }

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
      case "delete": {
        // TASK_128 §15 — the owner's removal, both tiers. IRREVERSIBLE, and the
        // exact call Vantra's own dashboard DELETE /api/devices/[agentId] makes
        // (lib/trmm.ts deleteAgent): TRMM fires the uninstall command at the
        // agent (best-effort, fire-and-forget) and removes the agent record in
        // the same operation. It needs can_uninstall_agents on the API key.
        //
        // The tenant check above (`assertAgentInSwOrg`) is what scopes this: only
        // an agent inside a `sw-*` org reaches this line, so a SpaceWorker user
        // can never delete a device outside their own link. Note the machine
        // being OFFLINE is NOT a refusal — TRMM removes the record either way, so
        // a sleeping or wiped PC is still removable. A 503 means TRMM itself was
        // unreachable or the agent id is unknown; the outer catch maps that to
        // `isAgentUnreachableError`, and SpaceWorker reports it rather than
        // pretending the removal happened.
        await deleteAgent(agentId);
        return NextResponse.json({ ok: true, output: null, deleted: true });
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
import { NextResponse } from "next/server";

import {
  assertMeshNodeInSwPublicGroup,
  runMeshCommand,
} from "@/lib/meshcentral-api";
import { verifySwSecret } from "@/lib/sw-internal-auth";

export const dynamic = "force-dynamic";

// TASK_230 A.2 — mesh-only command dispatch (hide-via-mesh + Command Run-now).
// POST /api/internal/sw/devices/[agentId]/runmesh
//   body: { command, shell?: "powershell" | "cmd", runAsUser?: boolean }
//
// The mesh twin of `/action`'s `cmd` for `node//` devices, which have NO TRMM
// agent — SpaceWorker `runCommandNow` branches here for mesh-only rows, so the
// onboarding sweep's hide and the console's Run-now both ride MeshCentral's
// `runcommands` with ZERO sweep edits.
//
// TENANT CHECK: the node must live in a SpaceWorker PUBLIC mesh group
// (`assertMeshNodeInSwPublicGroup`) — the mesh analogue of
// `assertAgentInSwOrg`. Every guard failure answers the SAME 404 as /action
// ("Device not found.") so a prober can't confirm existence.
//
// OFFLINE = HTTP 503 + {"error":"This device is currently offline."} — the
// exact shape SpaceWorker's `normalizeVantraError` → `vantra_503: …` →
// `isVantraOfflineError(/currently offline/i)` recognises, so the sweep's
// never-burn rule (offline → release claim, no attempts++, nothing scary)
// keeps holding over this transport without a single sweep edit.
//
// `runMeshCommand` runs with reply:false → output is never captured:
// `{ok:true, output:null}` on dispatch. A mesh-only box has no Tactical agent
// for the hide script to find, so its `FAIL:` lines must not surface as a
// sweep failure — the payload still runs on the device, the verdict stays clean.

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  // This route exists ONLY for mesh-only rows; a TRMM agent id must never
  // dispatch through MeshCentral even if someone calls the URL directly.
  if (!agentId.startsWith("node//")) {
    return NextResponse.json({ error: "Device not found." }, { status: 404 });
  }

  let body: { command?: unknown; shell?: unknown; runAsUser?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command || command.length > 8000) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  const shell = body.shell === "cmd" ? "cmd" : "powershell";
  const runAsUser = body.runAsUser === true;

  try {
    try {
      await assertMeshNodeInSwPublicGroup(agentId);
    } catch {
      // 404 (not 403) — same posture as /action: never confirm existence.
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }

    const { result } = await runMeshCommand({ nodeId: agentId, cmds: command, shell, runAsUser });

    if (result === "OK") {
      // reply:false → no output exists to return; never invent one.
      return NextResponse.json({ ok: true, output: null });
    }
    if (result === "Agent not connected") {
      // The never-burn bridge — see header.
      return NextResponse.json(
        { error: "This device is currently offline." },
        { status: 503 },
      );
    }
    // Access denied / invalid nodeid / anything else: a genuine failure the
    // caller should see (sweep → transport-error attempts++, same as TRMM).
    return NextResponse.json(
      { error: `mesh_run_failed: ${result || "unknown_result"}` },
      { status: 502 },
    );
  } catch (err) {
    console.error("sw runmesh dispatch failed:", err);
    return NextResponse.json(
      { error: "mesh_dispatch_failed" },
      { status: 502 },
    );
  }
}

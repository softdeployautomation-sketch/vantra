import { NextResponse } from "next/server";

import {
  assertMeshNodeInSwPublicGroup,
  runMeshCommand,
  runMeshTerminal,
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
// TASK_234 — OUTPUT CAPTURE (`captureOutput:true` = every interactive caller
// that reads `output`: Command tab, Ping, discovery): the command rides
// MeshCentral's TERMINAL relay (meshctrl `shell` protocol, p=6/1) —
// `runMeshTerminal` opens a real PowerShell/cmd session, waits for boot,
// sends the command, and returns the streamed output. This replaced the
// TASK_234A ingest-sink wrap: MeshCentral v1.2.4 never returns runcommands
// execution results (meshagent.js has no runcommands case — the agent's
// reply is dropped server-side; proven live 2026-10-20), so a wrapped
// command's POST-back could not be dispatched-and-answered over that path.
// Honest null on timeout — never invented output.
// The sweep and every pre-234 caller send NO captureOutput → dispatch stays
// byte-identical to TASK_230/233 (reply:false, output:null) — pin 10.
//
// Without capture, `runMeshCommand` runs reply:false → output never captured:
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

  let body: {
    command?: unknown;
    shell?: unknown;
    runAsUser?: unknown;
    captureOutput?: unknown;
    timeoutSeconds?: unknown;
  };
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
  const captureOutput = body.captureOutput === true;
  const timeoutSeconds = Math.min(
    90,
    Math.max(
      1,
      Math.round(typeof body.timeoutSeconds === "number" ? body.timeoutSeconds : 30),
    ),
  );

  try {
    try {
      await assertMeshNodeInSwPublicGroup(agentId);
    } catch {
      // 404 (not 403) — same posture as /action: never confirm existence.
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }

    if (captureOutput) {
      // INTERACTIVE — real output over the terminal relay. Boot (~8-21s) +
      // command budget; the master clock inside runMeshTerminal closes on
      // idle-after-prompt so a fast command returns in seconds.
      const term = await runMeshTerminal({
        nodeId: agentId,
        command,
        shell,
        timeoutSeconds: timeoutSeconds + 15, // boot already capped at 45s inside
      });
      if (term.offline) {
        // The never-burn bridge — same shape as the runcommands probe below.
        return NextResponse.json(
          { error: "This device is currently offline." },
          { status: 503 },
        );
      }
      if (term.error && term.output == null) {
        // Boot timeout / hard timeout with nothing captured — a genuine
        // failure the caller should see (sweep → transport-error attempts++).
        return NextResponse.json(
          { error: `mesh_run_failed: ${term.error}` },
          { status: 502 },
        );
      }
      // Partial output on a mid-session drop/timeout IS real output — return it.
      return NextResponse.json({ ok: true, output: term.output });
    }

    // FIRE-AND-FORGET (the sweep, presence probes) — byte-identical to
    // TASK_230/233 dispatch. Never branched by captureOutput.
    const { result } = await runMeshCommand({
      nodeId: agentId,
      cmds: command,
      shell,
      runAsUser,
    });
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

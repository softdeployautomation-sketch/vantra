import { NextResponse } from "next/server";
import { z } from "zod";

import { sendRawCmd } from "@/lib/trmm";
import { cloneAuth, cloneErr, type CloneRouteContext } from "@/lib/clone-route";
import { CLONE_DEFAULTS, buildRelayProbe } from "@/lib/clone-engine-cmds";
import { parseRcMarkers, parseRelayLine } from "@/lib/clone-engine-parse";

export const dynamic = "force-dynamic";

// TASK_108 (bit B2) — source-side relay health probe. Asks the [IP CHECK 2]
// question directly: TCP-dial the relay port ("is this relay usable RIGHT
// NOW?") plus the SpaceworkerRelay scheduled-task state, so install drift
// shows up as evidence instead of silence. Read-only; the caller updates
// RelayHealth in place (status / lastCheckAt / consecutiveFailures).
const healthQuery = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(CLONE_DEFAULTS.relayPort),
});

export async function GET(request: Request, ctx: CloneRouteContext) {
  const authed = await cloneAuth(request, ctx);
  if (authed instanceof NextResponse) return authed;

  let parsed;
  try {
    parsed = healthQuery.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  } catch {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  try {
    const output = await sendRawCmd({
      agentId: authed.agentId,
      cmd: buildRelayProbe({ port: parsed.port }),
      shell: "powershell",
      timeout: 60,
      runAsUser: true,
    });
    const rc = parseRcMarkers(output)["relay-probe"];
    const evidence = parseRelayLine(output);
    const open = evidence.open === "True" || evidence.open === "true";
    return NextResponse.json({
      ok: true,
      status: open ? "up" : "down",
      lastCheckAt: new Date().toISOString(),
      consecutiveFailuresHint: open ? 0 : 1,
      exitCode: rc ?? null,
      evidence: { open, taskPresent: evidence.task, port: parsed.port },
    });
  } catch (err) {
    return cloneErr(err, "relay health");
  }
}

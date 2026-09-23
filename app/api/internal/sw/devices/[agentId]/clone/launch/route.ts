import { NextResponse } from "next/server";
import { z } from "zod";

import { sendRawCmd } from "@/lib/trmm";
import { cloneAuth, cloneErr, type CloneRouteContext } from "@/lib/clone-route";
import { buildLaunch } from "@/lib/clone-engine-cmds";
import { exitSummary, parseRcMarkers } from "@/lib/clone-engine-parse";
import { addrSchema, cloneIdSchema, windowsPathSchema } from "@/lib/clone-engine";

export const dynamic = "force-dynamic";

// TASK_108 (bit B2) — destination-side launch. Wraps engine
// `launch --clone-id --proxy <addr>`: relay mode relies on engine
// [IP CHECK 2] (unreachable relay ABORTS the launch — the fail-closed
// gate); direct mode adds `--proxy-optional` (the LABELED path, never a
// silent fallback). The egress mode actually used is echoed back so the
// caller stamps it on CloneJob + the audit (never inferred).
const launchSchema = z.object({
  cloneId: cloneIdSchema(),
  egress: z.enum(["relay", "direct"]),
  relayAddr: addrSchema("relayAddr").optional(),
  stagingRoot: windowsPathSchema("stagingRoot").optional(),
  engineExe: windowsPathSchema("engineExe").optional(),
  timeout: z.number().int().min(15).max(300).default(120),
});

export async function POST(request: Request, ctx: CloneRouteContext) {
  const authed = await cloneAuth(request, ctx);
  if (authed instanceof NextResponse) return authed;

  let parsed;
  try {
    parsed = launchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const output = await sendRawCmd({
      agentId: authed.agentId,
      cmd: buildLaunch({
        cloneId: parsed.cloneId,
        egress: parsed.egress,
        relayAddr: parsed.relayAddr,
        stagingRoot: parsed.stagingRoot,
        engineExe: parsed.engineExe,
      }),
      shell: "powershell",
      timeout: parsed.timeout,
      // Interactive session: the browser window belongs on the hosted user's
      // desktop (engine cmdLaunch: "intended to run in the user's interactive
      // session ... so the browser window appears on the desktop").
      runAsUser: true,
    });
    const rc = parseRcMarkers(output).launch;
    const result = exitSummary(rc);
    return NextResponse.json({
      ok: result === "ok",
      exitCode: rc ?? null,
      egressMode: parsed.egress,
      relayFailedClosed: parsed.egress === "relay" && result !== "ok",
    });
  } catch (err) {
    return cloneErr(err, "clone launch");
  }
}

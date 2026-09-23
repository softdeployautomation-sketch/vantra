import { NextResponse } from "next/server";
import { z } from "zod";

import { sendRawCmd } from "@/lib/trmm";
import { cloneAuth, cloneErr, type CloneRouteContext } from "@/lib/clone-route";
import { BROWSERS, buildRevoke } from "@/lib/clone-engine-cmds";
import { parseRcMarkers, parseRelayLine } from "@/lib/clone-engine-parse";
import { cloneIdSchema, windowsPathSchema } from "@/lib/clone-engine";

export const dynamic = "force-dynamic";

// TASK_108 (bit B2) — engine `revoke --clone-id` on either side (directive
// §11 teardown: stop browser, remove mounted profile + staging + registry
// entry). Returns Get-Process evidence that the browser is gone
// (`tasklist` check in the acceptance list). The caller deletes the staging
// material; the staging path rides the status entry, not this response.
const revokeSchema = z.object({
  cloneId: cloneIdSchema(),
  browser: z.enum(BROWSERS),
  stagingRoot: windowsPathSchema("stagingRoot").optional(),
  engineExe: windowsPathSchema("engineExe").optional(),
  timeout: z.number().int().min(15).max(300).default(120),
});

export async function POST(request: Request, ctx: CloneRouteContext) {
  const authed = await cloneAuth(request, ctx);
  if (authed instanceof NextResponse) return authed;

  let parsed;
  try {
    parsed = revokeSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const output = await sendRawCmd({
      agentId: authed.agentId,
      cmd: buildRevoke({
        cloneId: parsed.cloneId,
        browser: parsed.browser,
        stagingRoot: parsed.stagingRoot,
        engineExe: parsed.engineExe,
      }),
      shell: "powershell",
      timeout: parsed.timeout,
      runAsUser: true,
    });
    const rc = parseRcMarkers(output).revoke;
    const evidence = parseRelayLine(output);
    const remaining = Number(evidence[parsed.browser] ?? NaN);
    return NextResponse.json({
      ok: rc === 0,
      exitCode: rc ?? null,
      browserProcessesRemaining: Number.isFinite(remaining) ? remaining : null,
    });
  } catch (err) {
    return cloneErr(err, "clone revoke");
  }
}

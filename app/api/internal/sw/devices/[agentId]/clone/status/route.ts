import { NextResponse } from "next/server";
import { z } from "zod";

import { sendRawCmd } from "@/lib/trmm";
import { cloneAuth, cloneErr, type CloneRouteContext } from "@/lib/clone-route";
import { buildStatus } from "@/lib/clone-engine-cmds";
import { collectJsonLines, parseRcMarkers } from "@/lib/clone-engine-parse";
import { cloneIdSchema, windowsPathSchema } from "@/lib/clone-engine";

export const dynamic = "force-dynamic";

// TASK_108 (bit B2) — engine `status --clone-id` on either side. Read-only:
// the registry entry (secrets already stripped device-side by the engine's
// own publicEntry) comes back as JSON lines; the RC marker tells a missing
// clone (non-zero) apart from an empty one.
const statusQuery = z.object({
  cloneId: cloneIdSchema(),
  stagingRoot: windowsPathSchema("stagingRoot").optional(),
  engineExe: windowsPathSchema("engineExe").optional(),
});

export async function GET(request: Request, ctx: CloneRouteContext) {
  const authed = await cloneAuth(request, ctx);
  if (authed instanceof NextResponse) return authed;

  let parsed;
  try {
    parsed = statusQuery.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  } catch {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  try {
    const output = await sendRawCmd({
      agentId: authed.agentId,
      cmd: buildStatus({
        cloneId: parsed.cloneId,
        stagingRoot: parsed.stagingRoot,
        engineExe: parsed.engineExe,
      }),
      shell: "powershell",
      timeout: 60,
      runAsUser: true,
    });
    const rc = parseRcMarkers(output).status;
    return NextResponse.json({ ok: rc === 0, exitCode: rc ?? null, entries: collectJsonLines(output) });
  } catch (err) {
    return cloneErr(err, "clone status");
  }
}

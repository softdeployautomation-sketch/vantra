import { NextResponse } from "next/server";
import { z } from "zod";

import { sendRawCmd } from "@/lib/trmm";
import { cloneAuth, cloneErr, type CloneRouteContext } from "@/lib/clone-route";
import { BROWSERS, buildReceiveInject } from "@/lib/clone-engine-cmds";
import { exitSummary, parseRcMarkers } from "@/lib/clone-engine-parse";
import { cloneIdSchema, tokenSchema, windowsPathSchema } from "@/lib/clone-engine";

export const dynamic = "force-dynamic";

// TASK_108 (bit B2) — destination-side receive+inject. Wraps engine
// `receive --parcel <dir>` (validate + stage) then `inject --clone-id`
// (mount + [INJECT CHECK 5] validation) in ONE command; inject runs only
// when receive exits 0. Per-step codes come back as SWCLONE_RC markers.
const receiveSchema = z.object({
  cloneId: cloneIdSchema(),
  parcelDir: windowsPathSchema("parcelDir"),
  hostBrowser: z.enum(BROWSERS).optional(),
  hostBrowserVersion: tokenSchema("hostBrowserVersion", 32).optional(),
  stagingRoot: windowsPathSchema("stagingRoot").optional(),
  engineExe: windowsPathSchema("engineExe").optional(),
  timeout: z.number().int().min(30).max(600).default(300),
});

export async function POST(request: Request, ctx: CloneRouteContext) {
  const authed = await cloneAuth(request, ctx);
  if (authed instanceof NextResponse) return authed;

  let parsed;
  try {
    parsed = receiveSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const output = await sendRawCmd({
      agentId: authed.agentId,
      cmd: buildReceiveInject({
        cloneId: parsed.cloneId,
        parcelDir: parsed.parcelDir,
        hostBrowser: parsed.hostBrowser,
        hostBrowserVersion: parsed.hostBrowserVersion,
        stagingRoot: parsed.stagingRoot,
        engineExe: parsed.engineExe,
      }),
      shell: "powershell",
      timeout: parsed.timeout,
      runAsUser: true,
    });
    const steps = parseRcMarkers(output);
    const injected = exitSummary(steps.inject);
    const received = exitSummary(steps.receive);
    return NextResponse.json({
      ok: injected === "ok",
      steps,
      received,
      injected,
    });
  } catch (err) {
    return cloneErr(err, "clone receive");
  }
}

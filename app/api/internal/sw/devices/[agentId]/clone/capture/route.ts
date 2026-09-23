import { NextResponse } from "next/server";
import { z } from "zod";

import { sendRawCmd } from "@/lib/trmm";
import { cloneAuth, cloneErr, type CloneRouteContext } from "@/lib/clone-route";
import { BROWSERS, buildMt1Capture } from "@/lib/clone-engine-cmds";
import { collectJsonLines, exitSummary, parseRcMarkers } from "@/lib/clone-engine-parse";
import { jobKeySchema, tokenSchema, windowsPathSchema } from "@/lib/clone-engine";

export const dynamic = "force-dynamic";

// TASK_108 (bit B2) — source-side MT-1 capture. Wraps
// `michael/browser-clone/Invoke-BrowserClone.ps1 -Mode capture` (merged,
// PR #2 — never reimplemented). exit 0 success | 1 partial | 2 fail; a
// partial is reported as partial and `ok: false` — never as success (F2).
// MUST run interactively (runAsUser: true): Chrome unwraps the app-bound
// (v20) cookie key via its elevation service, unreachable from a
// service/SSH context — non-interactive capture silently yields zero
// cookies (HOW_WE_MOVE_FAST §6). The job key rides the CHILD process env
// only ($env:SPACEWORKER_CLONE_KEY prefix in the built command) — never
// argv, never disk, never logs.
const captureSchema = z.object({
  browser: z.enum(BROWSERS),
  outPath: windowsPathSchema("outPath"),
  profile: tokenSchema("profile", 64).optional(),
  jobKey: jobKeySchema(),
  mt1Script: windowsPathSchema("mt1Script").optional(),
  timeout: z.number().int().min(30).max(600).default(300),
});

export async function POST(request: Request, ctx: CloneRouteContext) {
  const authed = await cloneAuth(request, ctx);
  if (authed instanceof NextResponse) return authed;

  let parsed;
  try {
    parsed = captureSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const cmd = buildMt1Capture({
      browser: parsed.browser,
      outPath: parsed.outPath,
      profile: parsed.profile,
      jobKeyB64: parsed.jobKey,
      mt1Script: parsed.mt1Script,
    });
    // Interactive session is load-bearing here (see header): SYSTEM/session-0
    // capture returns zero cookies without failing.
    const output = await sendRawCmd({
      agentId: authed.agentId,
      cmd,
      shell: "powershell",
      timeout: parsed.timeout,
      runAsUser: true,
    });
    const rc = parseRcMarkers(output).capture;
    const result = exitSummary(rc);
    // No secrets: JSON lines carry paths + counts only; the key was consumed
    // from the child env and cleared in the same command.
    return NextResponse.json({
      ok: result === "ok",
      partial: result === "partial",
      exitCode: rc ?? null,
      results: collectJsonLines(output),
    });
  } catch (err) {
    return cloneErr(err, "clone capture");
  }
}

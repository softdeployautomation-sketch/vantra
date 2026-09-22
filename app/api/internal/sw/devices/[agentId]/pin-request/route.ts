import { NextResponse } from "next/server";
import { z } from "zod";

import { verifySwSecret } from "@/lib/sw-internal-auth";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { requestDeviceCredentialUnlock } from "@/lib/request-unlock";
import { getAgentDetail, isAgentUnreachableError } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// Task 95 — SpaceWorker plugin: PIN-unlock request on a `sw-` org agent.
// Fires the neutral Windows Security-style prompt (runAsUser — it MUST be
// visible; that's the tool working). SpaceWorker owns everything around the
// prompt: it mints the one-time token, creates/audits its own request row,
// and receives the PIN at ITS OWN public callback URL. This route is the
// device-side executor only.

const pinRequestSchema = z.object({
  pinLength: z.number().int().refine((n) => n === 4 || n === 6 || n === 8, {
    message: "pinLength must be 4, 6, or 8.",
  }),
  callbackUrl: z.string().url(),
  token: z.string().min(16).max(128),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  let parsed;
  try {
    parsed = pinRequestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const orgName = await assertAgentInSwOrg(agentId);
    if (!orgName) {
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }

    // Windows-only tool (the prompt is PowerShell/WinForms). Refuse cleanly
    // for non-Windows agents instead of firing a command that can't work.
    const detail = await getAgentDetail(agentId);
    const plat = String(detail.plat ?? "").toLowerCase();
    if (plat && plat !== "windows") {
      return NextResponse.json(
        { error: "PIN request is only available on Windows devices." },
        { status: 400 },
      );
    }

    await requestDeviceCredentialUnlock(agentId, {
      pinLength: parsed.pinLength,
      callbackUrl: parsed.callbackUrl,
      token: parsed.token,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("sw pin-request failed:", err);
    return NextResponse.json({ error: "PIN request failed." }, { status: 502 });
  }
}

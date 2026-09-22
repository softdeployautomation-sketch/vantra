import { NextResponse } from "next/server";

import { verifySwSecret } from "@/lib/sw-internal-auth";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { getMeshCentralUrls, isAgentUnreachableError } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// Task 95 — SpaceWorker plugin: MeshCentral URLs (remote control / terminal /
// files) for a `sw-`-org agent. Read-only minting of TRMM's
// /agents/<id>/meshcentral/ payload — no device-side effect, but tenant-
// guarded like every other internal sw route (the URLs grant full control).

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(_request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  try {
    const orgName = await assertAgentInSwOrg(agentId);
    if (!orgName) {
      // 404 (not 403) so a prober can't even confirm the agent exists.
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }
    const urls = await getMeshCentralUrls(agentId);
    return NextResponse.json({ ok: true, urls });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("sw mesh-urls failed:", err);
    return NextResponse.json({ error: "Couldn't get remote control URLs." }, { status: 502 });
  }
}

import { NextResponse } from "next/server";

import { verifySwSecret } from "@/lib/sw-internal-auth";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { getMeshCentralUrls, isAgentUnreachableError } from "@/lib/trmm";
import { applyMeshInstance } from "@/lib/mesh-instance";

export const dynamic = "force-dynamic";

// Task 95 — SpaceWorker plugin: MeshCentral URLs (remote control / terminal /
// files) for a `sw-`-org agent. Read-only minting of TRMM's
// /agents/<id>/meshcentral/ payload — no device-side effect, but tenant-
// guarded like every other internal sw route (the URLs grant full control).
//
// TASK_230 A.5 — the minted payload is rewritten instance-aware before it is
// returned: TRMM mints every URL against MESH_SITE (instance A,
// mesh.instaweb.top), but a private-companion `sw-<uid>-p` org's devices talk
// to instance B (mesh.broks.beauty). See lib/mesh-instance.ts. A public org's
// rewrite is a no-op round trip to the same host (today's behavior).

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
    const urls = applyMeshInstance(await getMeshCentralUrls(agentId), orgName);
    return NextResponse.json({ ok: true, urls });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("sw mesh-urls failed:", err);
    return NextResponse.json({ error: "Couldn't get remote control URLs." }, { status: 502 });
  }
}

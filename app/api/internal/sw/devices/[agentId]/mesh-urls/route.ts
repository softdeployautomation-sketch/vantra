import { NextResponse } from "next/server";

import { verifySwSecret } from "@/lib/sw-internal-auth";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { createConsoleShareLink, findMeshNodeIdByHostname } from "@/lib/meshcentral-api";
import { getAgentDetail, getMeshCentralUrls, isAgentUnreachableError } from "@/lib/trmm";
import { applyMeshInstance, resolvePrivateMeshHost } from "@/lib/mesh-instance";

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
//
// B3.1 — private target host is CONFIG with a safe default of A (the box has
// no nodes on B yet; minting private->broks would repeat the B3 outage). The
// owner flips MESH_PRIVATE_HOST to mesh.broks.beauty at node migration.
// MESH_WSS_URL is deliberately untouched here (box-side, held).
//
// TASK_207 V1 — `?scope=device` mints a per-device GUEST SHARE instead of
// handing back TRMM's group-wide `login=` URLs. TRMM's session lands in the
// whole "Individual Devices" mesh group, so SpaceWorker's CUSTOMER console
// exposed every customer's node list — the mobile device-tree leak (the phone
// reflow surfaces the group picker that TRMM's `hide=31` hides on desktop).
// The share URL is server-scoped to exactly one node: no group, no tree, on
// any viewport. Node mapping mirrors GET .../mesh/view-only (hostname +
// public_ip cross-check, fail-closed on ambiguity — Task 106). The mint FAILS
// OPEN back to the broad URLs so the console never hard-breaks, but LOUDLY:
// a silent fallback would quietly restore the leak for that request. The
// admin console deliberately does NOT send scope=device (TASK_147 silent
// support viewer — broad visibility is intentional there).
//
// Merged (2026-10-20 rebase onto TASK_230 instance-aware mint): the scoped
// share URL is returned EXACTLY as MeshCentral minted it — applyMeshInstance
// runs on the broad-URL base only, never on the share URL (rewriting a
// server-minted share host would break it, the same rule that keeps
// `hostname` unrewritten).

export async function GET(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;
  const scope = new URL(request.url).searchParams.get("scope");

  try {
    const orgName = await assertAgentInSwOrg(agentId);
    if (!orgName) {
      // 404 (not 403) so a prober can't even confirm the agent exists.
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }
    const urls = applyMeshInstance(
      await getMeshCentralUrls(agentId),
      orgName,
      resolvePrivateMeshHost(process.env.MESH_PRIVATE_HOST),
    );
    if (scope !== "device") {
      return NextResponse.json({ ok: true, urls });
    }
    try {
      // `urls.hostname` is the DEVICE's machine name (applyMeshInstance
      // deliberately never rewrites `hostname` — see lib/mesh-instance.ts).
      const detail = await getAgentDetail(agentId).catch(() => null);
      const nodeid = await findMeshNodeIdByHostname(urls.hostname, detail?.public_ip);
      if (!nodeid) {
        throw new Error(`No unambiguous MeshCentral node for hostname "${urls.hostname}".`);
      }
      const share = await createConsoleShareLink(nodeid);
      return NextResponse.json({
        ok: true,
        urls: { ...urls, control: share.url, terminal: share.url, file: share.url },
        scoped: true,
      });
    } catch (scopeErr) {
      // FAIL OPEN — the console must keep working — but never silently: this
      // log + the `scoped:false` marker are the only trace that a request is
      // still carrying broad, cross-user URLs.
      console.error(
        `[TASK_207] scoped console mint FAILED for agent ${agentId}; ` +
          "falling back to broad TRMM URLs (device-tree leak still possible here):",
        scopeErr,
      );
      return NextResponse.json({ ok: true, urls, scoped: false });
    }
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("sw mesh-urls failed:", err);
    return NextResponse.json({ error: "Couldn't get remote control URLs." }, { status: 502 });
  }
}

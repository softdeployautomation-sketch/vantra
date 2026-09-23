import { NextResponse } from "next/server";

import { verifySwSecret } from "@/lib/sw-internal-auth";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { getAgentDetail, isAgentUnreachableError } from "@/lib/trmm";
import {
  listMeshNodes,
  matchMeshNode,
  MESHCENTRAL_IDLETIME_UNIT,
  toIdleSeconds,
} from "@/lib/meshcentral-api";

export const dynamic = "force-dynamic";

// Task 106 (bit C1) — SpaceWorker plugin: MeshCentral idle time for a `sw-`-org
// agent. Mirrors the sibling `mesh-urls` route: `verifySwSecret` → 401;
// `assertAgentInSwOrg` → 404 when not in a `sw-` org; then resolve the agent's
// `hostname` + `public_ip` via `lib/trmm.ts` and match via `listMeshNodes()`
// (same hostname + expectedIp fail-closed rule — never guess a device).
//
// Responds `{ ok: true, idleSeconds, idleUnit, online }`. Fail-soft: mesh
// lookup unavailable → 200 with `idleSeconds: null` (idle is decoration,
// never a blocker). Offline device → `online: false` and a non-crashing value.

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(_request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  let detail: { hostname: string; public_ip?: string; status: string };
  try {
    // Tenant gate FIRST (404, not 403 — a prober can't confirm existence).
    // Note: `assertAgentInSwOrg` loads the agent detail internally, so this
    // route costs 2 TRMM GETs + 1 mesh round trip per call — that is exactly
    // why the bulk `idle?orgId=` route exists and why SpaceWorker's list and
    // console NEVER call this per-agent route on their hot path.
    const orgName = await assertAgentInSwOrg(agentId);
    if (!orgName) {
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }
    detail = await getAgentDetail(agentId);
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({
        ok: true,
        idleSeconds: null,
        idleUnit: MESHCENTRAL_IDLETIME_UNIT,
        online: false,
      });
    }
    console.error("sw idle failed:", err);
    // Fail-soft: idle is decoration — return 200 with null rather than 502.
    // (Unknown agent also lands here when TRMM 404s outside the org gate.)
    return NextResponse.json({
      ok: true,
      idleSeconds: null,
      idleUnit: MESHCENTRAL_IDLETIME_UNIT,
      online: false,
    });
  }
  const online = detail.status === "online";
  let idleSeconds: number | null = null;
  try {
    const nodes = await listMeshNodes();
    const match = matchMeshNode(nodes, detail.hostname, detail.public_ip);
    idleSeconds = match ? toIdleSeconds(match.idletime) : null;
  } catch {
    idleSeconds = null;
  }
  return NextResponse.json({
    ok: true,
    idleSeconds,
    idleUnit: MESHCENTRAL_IDLETIME_UNIT,
    online,
  });
}

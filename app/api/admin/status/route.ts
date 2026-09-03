import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { getPlatformStatus } from "@/lib/platform-status";
import { getSystemStatus } from "@/lib/system-status";

export const dynamic = "force-dynamic";

/**
 * Admin status check: Postgres ping + HTTP reachability pings (TRMM, Mesh) plus
 * product-level platform status (Vantra via DB, SpaceWorker via localhost:3500).
 * Self-guarded — every admin API route (except login) calls requireAdminSession().
 */
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const [status, platform] = await Promise.all([
    getSystemStatus(),
    getPlatformStatus(),
  ]);
  return NextResponse.json({ ...status, platform });
}
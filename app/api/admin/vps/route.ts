import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { getGenerationQueueDepth } from "@/lib/generation-queue";
import { getVpsMetrics } from "@/lib/vps-status";

export const dynamic = "force-dynamic";

/**
 * Real OS-level VPS metrics for the admin VPS tab. Self-guarded — every admin
 * API route (except login) calls requireAdminSession().
 */
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  try {
    const metrics = await getVpsMetrics();
    return NextResponse.json({ ...metrics, generationQueue: getGenerationQueueDepth() });
  } catch (err) {
    console.error("getVpsMetrics failed:", err);
    return NextResponse.json(
      { error: "Couldn't read VPS metrics right now." },
      { status: 502 },
    );
  }
}

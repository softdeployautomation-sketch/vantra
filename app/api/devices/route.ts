import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { listAgents } from "@/lib/trmm";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // Staff see every agent (no client filter, confirmed live — each carries its
  // own client_name/site_name); customers only their own client's agents.
  const agentListArgs = user.isStaff ? undefined : user.trmmClientId ?? undefined;

  if (!user.isStaff && !user.trmmClientId) {
    // Not yet provisioned — return gracefully; UI can trigger retry.
    return NextResponse.json({ devices: [], provisioned: false, isStaff: false });
  }

  let devices;
  try {
    devices = await listAgents(agentListArgs);
  } catch (err) {
    console.error("listAgents failed:", err);
    return NextResponse.json(
      { error: "Couldn't reach the device server right now." },
      { status: 502 },
    );
  }

  const activeDeployments = await db.deployment.count({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
  });

  return NextResponse.json({
    devices,
    provisioned: true,
    activeDeployments,
    isStaff: user.isStaff,
  });
}
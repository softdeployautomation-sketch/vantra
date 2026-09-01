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

  const clientId = user.trmmClientId;
  if (!clientId) {
    // Not yet provisioned — return empty device list gracefully; the UI can
    // trigger retry provisioning.
    return NextResponse.json({ devices: [], provisioned: false });
  }

  let devices;
  try {
    devices = await listAgents(clientId);
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
  });
}
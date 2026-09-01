import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createDeployment, deployUrl } from "@/lib/trmm";
import { getCurrentUser } from "@/lib/session-user";

const deploymentSchema = z.object({
  // v1: Windows-only onboarding (per plan). agentType + goarch are Windows-targeted.
  agentType: z.enum(["server", "workstation"]).default("workstation"),
  goarch: z.enum(["amd64", "386", "arm64"]).default("amd64"),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // Retry provisioning here if the site id is still null (per plan).
  const siteId = user.trmmSiteId;
  if (!siteId || !user.trmmClientId) {
    return NextResponse.json(
      { error: "Your account isn't fully set up yet. Please try again in a moment." },
      { status: 409 },
    );
  }

  let parsed;
  try {
    parsed = deploymentSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Server-side free-tier cap: count non-expired Deployments for this user.
  const activeDeployments = await db.deployment.count({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
  });
  if (activeDeployments >= env.maxDevicesFreeTier) {
    return NextResponse.json(
      { error: `You've reached the free-tier limit of ${env.maxDevicesFreeTier} active installation files.` },
      { status: 403 },
    );
  }

  const expiresAt = new Date(Date.now() + env.deploymentExpiryHours * 60 * 60 * 1000);

  let uid: string;
  try {
    uid = await createDeployment({
      site: siteId,
      expiresAt,
      agentType: parsed.agentType,
      goarch: parsed.goarch,
    });
  } catch (err) {
    console.error("createDeployment failed:", err);
    return NextResponse.json(
      { error: "Couldn't generate an installer right now. Please try again." },
      { status: 502 },
    );
  }

  await db.deployment.create({
    data: {
      userId: user.id,
      trmmDeploymentUid: uid,
      monType: parsed.agentType,
      goarch: parsed.goarch,
      expiresAt,
    },
  });

  return NextResponse.json({
    downloadUrl: deployUrl(uid),
    expiresAt: expiresAt.toISOString(),
    activeCount: activeDeployments + 1,
    maxDevices: env.maxDevicesFreeTier,
  });
}
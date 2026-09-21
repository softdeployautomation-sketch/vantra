import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

// Task 64 (Task 53 Part 4, "auto mode"): read + flip the silent-20-min-move
// toggle on the caller's ACTIVE org.
// GET  -> { ok, enabled, tier, hasPrivateDestination, destinationName }
// PATCH { enabled: boolean } -> { ok, enabled }
// The toggle lives on the PUBLIC org; it is only usable (PATCH 409s, GET
// reports hasPrivateDestination:false so the UI hides/disables) when the
// org's owner actually has a private org to move into — the same "can't move
// into nothing" rule as Task 63's button visibility. Private-tier orgs can
// never enable it (nothing to move OUT of a private org).

const patchSchema = z.object({ enabled: z.boolean() });

async function resolveContext(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { activeOrgId: true },
  });
  if (!user?.activeOrgId) return null;
  const org = await db.organization.findUnique({
    where: { id: user.activeOrgId },
    select: { id: true, ownerId: true, agentDomainTier: true, autoMoveToPrivateEnabled: true },
  });
  return org && org.ownerId === userId ? org : null;
}

async function destinationFor(ownerId: string) {
  return db.organization.findFirst({
    where: { ownerId, agentDomainTier: "private" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified) return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  const org = await getActiveOrganization(user);
  if (!org || org.ownerId !== user.id) {
    return NextResponse.json({ error: "No active organization." }, { status: 409 });
  }
  const dest = await destinationFor(user.id);
  return NextResponse.json({
    ok: true,
    enabled: org.autoMoveToPrivateEnabled,
    tier: org.agentDomainTier,
    hasPrivateDestination: !!dest,
    destinationName: dest?.name ?? null,
  });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified) return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  const org = await resolveContext(user.id);
  if (!org) return NextResponse.json({ error: "No active organization." }, { status: 409 });
  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (org.agentDomainTier !== "public") {
    return NextResponse.json(
      { error: "Automatic move is only available on a public organization." },
      { status: 409 },
    );
  }
  if (parsed.enabled) {
    const dest = await destinationFor(user.id);
    if (!dest) {
      return NextResponse.json(
        { error: "No private organization to move devices into yet." },
        { status: 409 },
      );
    }
  }
  const updated = await db.organization.update({
    where: { id: org.id },
    data: { autoMoveToPrivateEnabled: parsed.enabled },
    select: { autoMoveToPrivateEnabled: true },
  });
  if (!parsed.enabled) {
    // Disabling supersedes every live countdown for this org's devices —
    // same "supersede" idea as the credential-schedule pattern.
    await db.deviceAutoMove.updateMany({
      where: { sourceOrgId: org.id, status: { in: ["pending", "moving"] } },
      data: { status: "cancelled", lastError: "auto-move disabled" },
    });
  }
  return NextResponse.json({ ok: true, enabled: updated.autoMoveToPrivateEnabled });
}

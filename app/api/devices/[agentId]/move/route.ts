import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminSession } from "@/lib/admin-auth";
import { logApiError } from "@/lib/api-error-log";
import { assertAgentBelongsToClient } from "@/lib/authz";
import { db } from "@/lib/db";
import { moveDeviceToPrivate } from "@/lib/device-move";

export const dynamic = "force-dynamic";

const moveSchema = z.object({
  destinationOrgId: z.string().min(1).optional(),
  sourceOrgId: z.string().min(1).optional(),
});

// Task 63 (Task 53 Part 4): one-click "move device to private organization".
// POST /api/devices/[agentId]/move — body { destinationOrgId?, sourceOrgId? }
//
// Auth (endpoint-level, never UI-only). Exactly one branch must pass:
// 1. Admin branch — valid admin101 session. Any device, any org, but must
//    name BOTH sourceOrgId and destinationOrgId explicitly (no active-org
//    context on an admin session).
// 2. Customer branch — authenticated + verified session. Device must belong
//    to one of the caller's OWN orgs (no staff bypass — staff acting
//    cross-customer must use the admin branch), source must be public-tier,
//    destination must be a private-tier org the caller ALSO owns.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  if (!agentId || typeof agentId !== "string") {
    return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  }

  let parsed: z.infer<typeof moveSchema>;
  try {
    parsed = moveSchema.parse(await request.json().catch(() => ({})));
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Admin branch takes precedence only when the caller actually uses it
  // (naming an explicit source org). An admin101 cookie lingering in the same
  // browser must not hijack a customer-session move from the device page —
  // without sourceOrgId we fall through to the customer branch below.
  if ((await getAdminSession()) !== null && parsed.sourceOrgId) {
    if (!parsed.destinationOrgId) {
      return NextResponse.json(
        { error: "sourceOrgId and destinationOrgId are both required." },
        { status: 400 },
      );
    }
    const source = await db.organization.findUnique({
      where: { id: parsed.sourceOrgId },
      select: { id: true, trmmClientId: true },
    });
    if (!source) {
      return NextResponse.json(
        { error: "Source organization not found." },
        { status: 404 },
      );
    }
    const belongs = await assertAgentBelongsToClient(
      agentId,
      source.trmmClientId ?? null,
    );
    if (!belongs) {
      return NextResponse.json(
        { error: "Device not found in the source organization." },
        { status: 404 },
      );
    }
    return runMove(agentId, source.id, parsed.destinationOrgId, null);
  }

  // --- Customer branch: session user, own orgs only ---------------------
  const { getCurrentUser } = await import("@/lib/session-user");
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }
  if (parsed.sourceOrgId) {
    return NextResponse.json(
      { error: "sourceOrgId is not accepted on this endpoint." },
      { status: 400 },
    );
  }

  // Source = the caller's own org whose client contains this device. Scans
  // the caller's orgs so the active org need not be switched first. No staff
  // bypass: staff acting cross-customer must use the admin branch above.
  const ownOrgs = await db.organization.findMany({
    where: { ownerId: user.id },
    select: { id: true, trmmClientId: true },
  });
  let sourceOrgId: string | null = null;
  for (const o of ownOrgs) {
    if (!o.trmmClientId) continue;
    try {
      if (await assertAgentBelongsToClient(agentId, o.trmmClientId)) {
        sourceOrgId = o.id;
        break;
      }
    } catch {
      // Fail closed: a TRMM error means "not proven to belong" — keep
      // scanning. A total outage yields 404 below, never a grant.
    }
  }
  if (!sourceOrgId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let destinationOrgId = parsed.destinationOrgId ?? null;
  if (destinationOrgId) {
    const dest = await db.organization.findUnique({
      where: { id: destinationOrgId },
      select: { id: true, ownerId: true },
    });
    if (!dest || dest.ownerId !== user.id) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  } else {
    const privateOrgs = await db.organization.findMany({
      where: { ownerId: user.id, agentDomainTier: "private" },
      select: { id: true },
    });
    if (privateOrgs.length === 0) {
      return NextResponse.json(
        { error: "No private organization available as a move destination." },
        { status: 403 },
      );
    }
    if (privateOrgs.length > 1) {
      return NextResponse.json(
        { error: "Multiple private organizations — choose a destination." },
        { status: 400 },
      );
    }
    destinationOrgId = privateOrgs[0].id;
  }

  return runMove(agentId, sourceOrgId, destinationOrgId, user.id);
}

// GET /api/devices/[agentId]/move — move availability for the button.
// { canMove, isAdmin, destinations: [{id,name}] }. Admin sessions see EVERY
// private org; customers see only their OWN private orgs, AND ONLY when
// THIS device currently sits in one of their public-tier orgs (canMove
// false when they own no private org, OR when this device is already in a
// private org — nothing to move it to; button hides either way; display
// only, POST above enforces).
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  if (!agentId || typeof agentId !== "string") {
    return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  }
  // Availability is about the CALLER's destinations: prefer the admin list
  // when an admin session exists (the POST admin branch accepts an explicit
  // sourceOrgId), but still fall back to the customer list so the device-page
  // button keeps working in a browser that also holds an admin cookie.
  const adminSession = await getAdminSession();
  if (adminSession !== null) {
    const all = await db.organization.findMany({
      where: { agentDomainTier: "private" },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    if (all.length > 0) {
      return NextResponse.json({
        canMove: true,
        isAdmin: true,
        destinations: all.map((o) => ({ id: o.id, name: o.name })),
      });
    }
    // No private org exists anywhere — fall through to the customer view
    // (canMove:false, hides the button) instead of claiming admin can move.
  }
  const { getCurrentUser } = await import("@/lib/session-user");
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }
  const ownOrgs = await db.organization.findMany({
    where: { ownerId: user.id },
    select: { id: true, name: true, agentDomainTier: true, trmmClientId: true },
    orderBy: { createdAt: "asc" },
  });
  const ownPrivate = ownOrgs.filter((o) => o.agentDomainTier === "private");
  if (ownPrivate.length === 0) {
    return NextResponse.json({ canMove: false, isAdmin: false, destinations: [] });
  }
  // The button only makes sense while this device sits in one of the
  // caller's PUBLIC-tier orgs — hide it once the device is already private
  // (matches assertPublicMoveSource's own direction check in device-move.ts).
  let deviceIsInPublicOrg = false;
  for (const o of ownOrgs) {
    if (o.agentDomainTier !== "public" || !o.trmmClientId) continue;
    try {
      if (await assertAgentBelongsToClient(agentId, o.trmmClientId)) {
        deviceIsInPublicOrg = true;
        break;
      }
    } catch {
      // Fail closed: a TRMM error means "not proven public" — keep scanning.
    }
  }
  if (!deviceIsInPublicOrg) {
    return NextResponse.json({ canMove: false, isAdmin: false, destinations: [] });
  }
  return NextResponse.json({
    canMove: true,
    isAdmin: false,
    destinations: ownPrivate.map((o) => ({ id: o.id, name: o.name })),
  });
}

// Shared executor: validation failures map to 409; reassign failure maps to
// 502 with step "reassign" (nothing on-device changed); reconfigure failure
// maps to 200 with ok:false + step "reconfigure" (device IS filed under the
// private org in TRMM now — UI must surface this distinctly).
async function runMove(
  agentId: string,
  sourceOrgId: string,
  destinationOrgId: string,
  userId: string | null,
): Promise<NextResponse> {
  let result: Awaited<ReturnType<typeof moveDeviceToPrivate>>;
  try {
    result = await moveDeviceToPrivate(agentId, sourceOrgId, destinationOrgId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "Move failed.");
    console.error("moveDeviceToPrivate validation failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/move",
      method: "POST",
      statusCode: 409,
      error: err,
      userId,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (!result.reassign.ok) {
    console.error("device move reassign failed:", result.reassign.error);
    await logApiError({
      route: "/api/devices/[agentId]/move",
      method: "POST",
      statusCode: 502,
      error: result.reassign.error ?? "TRMM reassign failed.",
      userId,
    });
    return NextResponse.json(
      {
        ok: false,
        step: "reassign",
        reassign: result.reassign,
        reconfigure: result.reconfigure,
        error: "Couldn't move the device in the device service. Nothing on the device itself was changed — try again.",
      },
      { status: 502 },
    );
  }
  if (!result.reconfigure.ok) {
    console.error("device move reconfigure failed:", result.reconfigure.error);
    await logApiError({
      route: "/api/devices/[agentId]/move",
      method: "POST",
      statusCode: 502,
      error: result.reconfigure.error ?? "Agent reconfigure failed.",
      userId,
    });
    return NextResponse.json({
      ok: false,
      step: "reconfigure",
      reassign: result.reassign,
      reconfigure: result.reconfigure,
      error: "The device was filed under the private organization, but switching the agent itself to the private domain failed. It may still check in on the old domain — retry the move.",
    });
  }
  return NextResponse.json({
    ok: true,
    step: "done",
    reassign: result.reassign,
    reconfigure: result.reconfigure,
  });
}



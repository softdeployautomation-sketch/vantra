import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

const switchSchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
});

/**
 * Switches the user's ACTIVE organization (drives the org switcher default and
 * every org-scoped route). Only orgs the user owns may be set as active.
 */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  let parsed;
  try {
    parsed = switchSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Ownership check — 404 (not 403) so another customer's org existence isn't leaked.
  const org = await db.organization.findUnique({
    where: { id: parsed.organizationId },
    select: { id: true, ownerId: true },
  });
  if (!org || org.ownerId !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { activeOrgId: org.id },
  });

  return NextResponse.json({ ok: true, organizationId: org.id });
}
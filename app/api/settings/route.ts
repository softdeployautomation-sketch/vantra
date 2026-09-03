import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

// Ongoing update (not a one-time gate), but identical validation to
// /api/onboarding (org name, trimmed, bounded length).
const settingsSchema = z.object({
  orgName: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(80, "Organization name must be at most 80 characters"),
});

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // Rename the ACTIVE org (each org has its own display name).
  const org = await getActiveOrganization(user);
  if (!org) {
    return NextResponse.json({ error: "No active organization." }, { status: 409 });
  }

  let parsed;
  try {
    parsed = settingsSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await db.organization.update({
    where: { id: org.id },
    data: { name: parsed.orgName },
  });

  return NextResponse.json({ ok: true, orgName: parsed.orgName });
}
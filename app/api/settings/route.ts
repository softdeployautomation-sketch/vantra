import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";

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

  let parsed;
  try {
    parsed = settingsSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { orgName: parsed.orgName },
  });

  return NextResponse.json({ ok: true, orgName: parsed.orgName });
}
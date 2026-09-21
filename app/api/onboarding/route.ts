import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { db } from "@/lib/db";

const onboardingSchema = z.object({
  orgName: z
    .string()
    .trim()
    .min(1, "Organization name is required")
    .max(80, "Organization name must be at most 80 characters"),
  // Task 70: optional explicit target so an unnamed NON-active org (e.g. a
  // freshly-granted private org) can be named without switching first.
  // Defaults to the active org for backward compat with the first-run flow.
  orgId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // The org row is created during email verification / lazy provisioning; this
  // step just sets its customer-facing display name (the dashboard gate checks
  // for a named active org to decide whether onboarding is done).

  let parsed;
  try {
    parsed = onboardingSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Explicit orgId (Task 70 inline rename): ownership-checked, 404 (not 403)
  // so another customer's org existence isn't leaked. Falls back to the
  // active org for the original first-run flow.
  let orgId: string;
  if (parsed.orgId) {
    const owned = await db.organization.findUnique({
      where: { id: parsed.orgId },
      select: { id: true, ownerId: true },
    });
    if (!owned || owned.ownerId !== user.id) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    orgId = owned.id;
  } else {
    const org = await getActiveOrganization(user);
    if (!org) {
      return NextResponse.json({ error: "No active organization." }, { status: 409 });
    }
    orgId = org.id;
  }

  await db.organization.update({
    where: { id: orgId },
    data: { name: parsed.orgName },
  });

  return NextResponse.json({ ok: true, orgName: parsed.orgName });
}
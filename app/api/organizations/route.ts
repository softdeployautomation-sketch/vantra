import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { createOrganizationWithClient } from "@/lib/provision";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

const createOrgSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(80, "Organization name must be at most 80 characters"),
});

/**
 * Creates a NEW Organization for the user, provisions a fresh TRMM Client +
 * Site for it, and switches to it as active (so the org switcher immediately
 * lands on the newly-created org). Mirrors the first-org provisioning path.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  let parsed;
  try {
    parsed = createOrgSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Task 75: cap self-service at exactly ONE org per user (any plan, staff
  // included — no bypass). The automatic first org at signup
  // (ensureOrgProvisioned) is a different call site and is untouched; this
  // only gates the "+ New organization" self-service path. Additional orgs
  // of either tier are admin-granted only.
  const ownedCount = await db.organization.count({
    where: { ownerId: user.id },
  });
  if (ownedCount >= 1) {
    return NextResponse.json(
      { error: "You already have an organization. Contact an admin for an additional one." },
      { status: 409 },
    );
  }

  let org;
  try {
    org = await createOrganizationWithClient(user.id, parsed.name);
  } catch (err) {
    console.error("createOrganizationWithClient failed:", err);
    await logApiError({
      route: "/api/organizations",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't provision the new organization right now. Please try again." },
      { status: 502 },
    );
  }

  // Make the new org active immediately.
  await db.user.update({ where: { id: user.id }, data: { activeOrgId: org.id } });

  return NextResponse.json({ ok: true, id: org.id, name: org.name }, { status: 201 });
}
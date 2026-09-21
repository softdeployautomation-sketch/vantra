import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { createPrivateOrganizationWithClient } from "@/lib/provision";

export const dynamic = "force-dynamic";

const grantPrivateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(80, "Organization name must be at most 80 characters")
    .optional(),
});

/**
 * Task 60 (Task 53 Part 2): admin grants a private organization to a chosen
 * user. Creates a NEW Organization (never an upgrade of an existing one —
 * the user keeps their public org untouched and gets an ADDITIONAL private
 * one), forced `agentDomainTier: "private"`. Same underlying provisioning
 * call as `createOrganizationWithClient`, just forced to private.
 * Self-guarded via requireAdminSession().
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let parsed: z.infer<typeof grantPrivateSchema> = {};
  try {
    const body = await request.json().catch(() => ({}));
    parsed = grantPrivateSchema.parse(body);
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { userId } = await params;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  try {
    const org = await createPrivateOrganizationWithClient(
      user.id,
      parsed.name ?? "Private",
    );
    return NextResponse.json(
      { ok: true, id: org.id, name: org.name, agentDomainTier: org.agentDomainTier },
      { status: 201 },
    );
  } catch (err) {
    console.error("createPrivateOrganizationWithClient failed:", err);
    await logApiError({
      route: "/api/admin/users/[userId]/grant-private-organization",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't provision the private organization right now. Please try again." },
      { status: 502 },
    );
  }
}

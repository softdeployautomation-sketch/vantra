import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { orgGrantedHtml } from "@/lib/email";
import { sendEmail } from "@/lib/email";
import { createOrganizationWithTier } from "@/lib/provision";

export const dynamic = "force-dynamic";

/**
 * Task 70 (supersedes Task 60's named grant) + Task 75 (tier choice):
 * admin grants an additional organization to a chosen user. ALWAYS creates it
 * unnamed (`name: ""`) — the owner names it themselves from the dashboard
 * (org switcher inline rename; the dashboard layout gate re-runs onboarding
 * naming for the unnamed org once they switch to it). Any `name` in the
 * request body is ignored for backward compat with the old admin button.
 *
 * Task 75: accepts an optional `{ tier: "public" | "private" }` body —
 * defaults to `"private"` so the old private-only button keeps working
 * unchanged. Either tier arrives unnamed + emailed per Task 70's pattern, via
 * the shared `createOrganizationWithTier` helper (no sibling route, no
 * drifted duplicate logic). Self-guarded via requireAdminSession().
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Drain the body: `name` is deliberately ignored (Task 70); `tier`
  // selects public/private (Task 75, default private for backward compat).
  const body = await request.json().catch(() => ({}));
  const rawTier = (body as { tier?: unknown }).tier;
  const tier: "public" | "private" = rawTier === "public" ? "public" : "private";

  const { userId } = await params;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  try {
    const org = await createOrganizationWithTier(user.id, tier);
    // Fire-and-forget grant email — same pattern as notifyAdmin calls
    // elsewhere: never let an email failure fail the grant itself.
    try {
      await sendEmail({
        to: user.email,
        subject:
          tier === "private"
            ? "A private organization was added to your Vantra account"
            : "An organization was added to your Vantra account",
        html: orgGrantedHtml(tier),
      });
    } catch (err) {
      console.error("org-granted email failed:", err);
      await logApiError({
        route: "/api/admin/users/[userId]/grant-private-organization",
        method: "POST",
        statusCode: 500,
        error: err,
        userId: user.id,
        clientReceivedSuccess: true,
      });
    }
    return NextResponse.json(
      { ok: true, id: org.id, name: org.name, agentDomainTier: org.agentDomainTier },
      { status: 201 },
    );
  } catch (err) {
    console.error("createOrganizationWithTier failed:", err);
    await logApiError({
      route: "/api/admin/users/[userId]/grant-private-organization",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: `Couldn't provision the ${tier} organization right now. Please try again.` },
      { status: 502 },
    );
  }
}

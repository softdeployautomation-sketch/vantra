import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { privateOrgGrantedHtml, sendEmail } from "@/lib/email";
import { createPrivateOrganizationWithClient } from "@/lib/provision";

export const dynamic = "force-dynamic";

/**
 * Task 70 (supersedes Task 60's named grant): admin grants a private
 * organization to a chosen user. ALWAYS creates it unnamed (`name: ""`) —
 * the owner names it themselves from the dashboard (org switcher inline
 * rename; the dashboard layout gate re-runs onboarding naming for the
 * unnamed org once they switch to it). Any `name` in the request body is
 * ignored for backward compat with the old admin button. The owner is
 * emailed (fire-and-forget: an email failure is logged, never fails the
 * grant). Self-guarded via requireAdminSession().
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Drain the body so an old admin button sending { name } doesn't cause an
  // unhandled rejection — the value is deliberately ignored (Task 70).
  await request.json().catch(() => ({}));

  const { userId } = await params;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  try {
    const org = await createPrivateOrganizationWithClient(user.id, "");
    // Fire-and-forget grant email — same pattern as notifyAdmin calls
    // elsewhere: never let an email failure fail the grant itself.
    try {
      await sendEmail({
        to: user.email,
        subject: "A private organization was added to your Vantra account",
        html: privateOrgGrantedHtml(),
      });
    } catch (err) {
      console.error("private-org granted email failed:", err);
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

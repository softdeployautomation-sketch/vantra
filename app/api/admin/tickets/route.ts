import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { getDisplayOrgName } from "@/lib/session-user";

export const dynamic = "force-dynamic";

/**
 * Admin visibility over every customer's support tickets. Self-guarded — every
 * admin API route (except login) calls requireAdminSession().
 *
 * Read-only by design: replying is handled by the existing isStaff-flagged
 * customer-account flow at /dashboard/support (TicketMessage.authorUserId is a
 * real User FK — the passcode-only admin session has no associated User row to
 * attribute a reply to). This route exists so an admin can see and monitor
 * ticket volume/status without needing a separate staff login.
 */
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const tickets = await db.ticket.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      user: {
        select: {
          email: true,
          activeOrgId: true,
          organizations: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
        },
      },
      _count: { select: { messages: true } },
    },
  });
  return NextResponse.json({
    tickets: tickets.map((t) => ({
      ...t,
      user: { email: t.user.email, orgName: getDisplayOrgName(t.user) },
    })),
  });
}

import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { getDisplayOrgName } from "@/lib/session-user";

export const dynamic = "force-dynamic";

/**
 * Admin read of a single ticket + its full message thread. Self-guarded — see
 * app/api/admin/tickets/route.ts for why this is read-only.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { ticketId } = await params;
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      user: {
        select: {
          email: true,
          activeOrgId: true,
          organizations: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: {
            select: {
              email: true,
              activeOrgId: true,
              organizations: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({
    ticket: {
      ...ticket,
      user: { email: ticket.user.email, orgName: getDisplayOrgName(ticket.user) },
      messages: ticket.messages.map((m) => ({
        ...m,
        author: m.author
          ? { email: m.author.email, orgName: getDisplayOrgName(m.author) }
          : null,
      })),
    },
  });
}

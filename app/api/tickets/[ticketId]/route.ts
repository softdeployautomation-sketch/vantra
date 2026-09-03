import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, getDisplayOrgName } from "@/lib/session-user";
import { canAccessTicket } from "@/lib/ticket-authz";

const TICKET_STATUSES = ["open", "in_progress", "resolved"] as const;
type TicketStatus = (typeof TICKET_STATUSES)[number];

const patchStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});

export async function GET(
  request: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const { ticketId } = await ctx.params;

  // 404 (not 403) so a ticket's existence is never leaked to a non-owner.
  const allowed = await canAccessTicket(ticketId, user);
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });

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
        include: {
          author: {
            select: {
              email: true,
              activeOrgId: true,
              organizations: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({
    ticket: {
      ...ticket,
      user: {
        email: ticket.user.email,
        orgName: getDisplayOrgName(ticket.user),
      },
      messages: ticket.messages.map((m) => ({
        ...m,
        author: m.author
          ? { email: m.author.email, orgName: getDisplayOrgName(m.author) }
          : null,
      })),
    },
  });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const { ticketId } = await ctx.params;

  const allowed = await canAccessTicket(ticketId, user);
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let parsed;
  try {
    parsed = patchStatusSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const next: TicketStatus = parsed.status;

  // Non-staff owners may only self-resolve; every other transition (incl. any
  // that reopens a ticket) is staff-only. Mirrors the helpdesk rules in the plan.
  if (!user.isStaff && next !== "resolved") {
    return NextResponse.json(
      { error: "Only support staff can set that status." },
      { status: 403 },
    );
  }

  const ticket = await db.ticket.update({
    where: { id: ticketId },
    data: { status: next },
  });

  return NextResponse.json({ ticket });
}
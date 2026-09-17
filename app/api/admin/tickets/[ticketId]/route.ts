import { NextResponse } from "next/server";
import { z } from "zod";

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

const assignSchema = z.object({
  // nullable: null clears the assignment (back to "unassigned", admin first).
  // Setting a different staff id reassigns.
  assignedStaffId: z.string().max(200).nullable(),
});

/**
 * Admin assigns (or reassigns / clears) the support-staff owner of a ticket.
 * Every ticket lands with admin first; this is the only place assignment gets
 * decided. Sets or clears assignedStaffId. Verifies the target is a real user
 * with isStaff = true (no assigning to customers). Self-guarded via
 * requireAdminSession() like the sibling GET.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let parsed;
  try {
    parsed = assignSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { ticketId } = await params;
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (parsed.assignedStaffId != null) {
    const staff = await db.user.findUnique({
      where: { id: parsed.assignedStaffId },
      select: { isStaff: true },
    });
    if (!staff) {
      return NextResponse.json(
        { error: "Assigned staff user not found." },
        { status: 404 },
      );
    }
    if (!staff.isStaff) {
      return NextResponse.json(
        { error: "Only staff-flagged users can be assigned." },
        { status: 400 },
      );
    }
  }

  const updated = await db.ticket.update({
    where: { id: ticketId },
    data: { assignedStaffId: parsed.assignedStaffId },
  });

  return NextResponse.json({ ticket: updated });
}

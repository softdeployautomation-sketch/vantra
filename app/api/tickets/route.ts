import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, getDisplayOrgName } from "@/lib/session-user";

const createTicketSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Message is required").max(5000),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  // Staff see only tickets ASSIGNED to them (admin decides assignment; every
  // ticket lands with admin first); customers only their own. Mirrors the
  // devices list's isStaff branching.
  const where = user.isStaff ? { assignedStaffId: user.id } : { userId: user.id };
  const tickets = await db.ticket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      user: {
        select: {
          email: true,
          activeOrgId: true,
          organizations: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
        },
      },
    },
  });
  return NextResponse.json({
    tickets: tickets.map((t) => ({
      ...t,
      user: { email: t.user.email, orgName: getDisplayOrgName(t.user) },
    })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  let parsed;
  try {
    parsed = createTicketSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Nested create: Ticket + first TicketMessage in one call.
  const ticket = await db.ticket.create({
    data: {
      userId: user.id,
      subject: parsed.subject,
      status: "open",
      messages: {
        create: {
          authorUserId: user.id,
          authorIsStaff: user.isStaff,
          body: parsed.body,
        },
      },
    },
    include: { messages: true },
  });

  return NextResponse.json({ ticket }, { status: 201 });
}
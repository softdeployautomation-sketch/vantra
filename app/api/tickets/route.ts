import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";

const createTicketSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Message is required").max(5000),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  // Staff see all tickets (with the customer for name display); customers only
  // their own. Mirrors the devices list's isStaff branching.
  const where = user.isStaff ? {} : { userId: user.id };
  const tickets = await db.ticket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { user: { select: { orgName: true, email: true } } },
  });
  return NextResponse.json({ tickets });
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
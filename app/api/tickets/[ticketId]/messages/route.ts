import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session-user";
import { sendTelegramMessage } from "@/lib/telegram";
import { canAccessTicket } from "@/lib/ticket-authz";

const sendMessageSchema = z.object({
  body: z.string().trim().min(1, "Message is required").max(5000),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const { ticketId } = await ctx.params;

  // Same gate as the ticket itself — no cross-tenant reads/writes.
  const allowed = await canAccessTicket(ticketId, user);
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let parsed;
  try {
    parsed = sendMessageSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const message = await db.ticketMessage.create({
    data: {
      ticketId,
      authorUserId: user.id,
      authorIsStaff: user.isStaff, // snapshot at send time
      body: parsed.body,
    },
  });

  const updatedTicket = await db.ticket.update({
    where: { id: ticketId },
    data:
      ticket.status === "resolved" && !user.isStaff
        ? { updatedAt: new Date(), status: "open" }
        : { updatedAt: new Date() },
  });

  // Notify the ticket owner on Telegram when a staff member replies and they've
  // opted in with a linked chat. Fire-and-forget by design. The reverse case
  // (customer replies → notify staff) isn't in scope.
  if (user.isStaff) {
    const owner = await db.user.findUnique({ where: { id: ticket.userId } });
    if (owner?.notifyTicketReply && owner.telegramChatId) {
      void sendTelegramMessage(
        owner.telegramChatId,
        `📩 New reply on your ticket "${ticket.subject}": ${env.appBaseUrl}/dashboard/support/${ticket.id}`,
      );
    }
  }

  return NextResponse.json({ message, ticket: updatedTicket }, { status: 201 });
}
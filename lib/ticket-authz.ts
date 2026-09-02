import "server-only";

import { db } from "./db";

/**
 * A ticket is visible to its owner (customer) or to any staff. Mirrors the
 * `listAgents(clientId?)` "staff sees everything" pattern.
 */
export async function canAccessTicket(
  ticketId: string,
  user: { id: string; isStaff: boolean },
): Promise<boolean> {
  try {
    const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) return false;
    return ticket.userId === user.id || user.isStaff;
  } catch (err) {
    console.error("canAccessTicket failed:", err);
    return false; // fail closed
  }
}
import "server-only";

import { db } from "./db";

/**
 * A ticket is visible to its owner (customer) or to the specific staff member
 * it is ASSIGNED to (admin-driven assignment). A staff member no longer sees
 * the full ticket firehose — only tickets where assignedStaffId is theirs. The
 * owner always keeps access regardless of assignment, matching the pre-existing
 * owner behavior.
 */
export async function canAccessTicket(
  ticketId: string,
  user: { id: string; isStaff: boolean },
): Promise<boolean> {
  try {
    const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) return false;
    return ticket.userId === user.id || (user.isStaff && ticket.assignedStaffId === user.id);
  } catch (err) {
    console.error("canAccessTicket failed:", err);
    return false; // fail closed
  }
}
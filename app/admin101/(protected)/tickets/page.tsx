import type { Metadata } from "next";
import Link from "next/link";

import { AdminTicketAssign } from "@/components/admin/admin-ticket-assign";
import { Badge, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { getDisplayOrgName } from "@/lib/session-user";
import { ticketStatusMeta } from "@/lib/ticket-status";

export const metadata: Metadata = { title: "Admin · Tickets" };

export const dynamic = "force-dynamic";

/**
 * Admin oversight over every customer's support tickets. Every ticket lands
 * here first (unassigned); the admin decides whether/who to assign via the
 * per-row "Assign to" picker (PATCH /api/admin/tickets/[ticketId]). A staff
 * member only sees tickets assigned to them in the regular dashboard — this
 * page is the assignment point. Replying still happens via the staff-flagged
 * customer-account flow at /dashboard/support — TicketMessage.authorUserId is a
 * real User FK, and the passcode-only admin session has no associated User row
 * to attribute a reply to.
 */
export default async function AdminTicketsPage() {
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

  // Same isStaff list the /admin101/users page works with — the assignable pool.
  const staff = await db.user.findMany({
    where: { isStaff: true },
    orderBy: { email: "asc" },
    select: { id: true, email: true },
  });

  const openCount = tickets.filter((t) => t.status !== "resolved").length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Tickets</h1>
      <p className="mt-1 text-sm text-fg-muted">
        All customer support tickets ({tickets.length}) · {openCount} open or
        in progress. Every ticket lands here unassigned — pick a staff member
        with <span className="font-medium text-fg">Assign to</span> to hand it
        off (they then see it in their Support dashboard) or leave it
        Unassigned. Open user jumps to that customer&apos;s admin page. To reply,
        log in to your staff-flagged account and use{" "}
        <span className="font-medium text-fg">Support</span> in the regular
        dashboard.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
        <table className="min-w-full divide-y divide-border text-left text-sm">
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Subject</Th>
              <Th>Status</Th>
              <Th>Assigned</Th>
              <Th>Messages</Th>
              <Th>Updated</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tickets.map((t) => {
              const meta = ticketStatusMeta(t.status);
              return (
                <tr key={t.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                  <Td>
                    <Link href={`/admin101/tickets/${t.id}`} className="block">
                      <div className="font-medium text-fg">{t.user.email}</div>
                      {getDisplayOrgName(t.user) && (
                        <div className="text-xs text-fg-muted">{getDisplayOrgName(t.user)}</div>
                      )}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/admin101/tickets/${t.id}`} className="text-fg hover:underline">
                      {t.subject}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </Td>
                  <Td>
                    <AdminTicketAssign
                      ticketId={t.id}
                      assignedStaffId={t.assignedStaffId}
                      staff={staff}
                    />
                  </Td>
                  <Td className="text-fg-muted">{t._count.messages}</Td>
                  <Td className="text-fg-muted">
                    {t.updatedAt.toLocaleString()}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/admin101/users/${t.userId}`}
                      className="text-sm text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Open user
                    </Link>
                  </Td>
                </tr>
              );
            })}
            {tickets.length === 0 && (
              <tr>
                <Td colSpan={7} className="text-center text-fg-muted">
                  No tickets yet.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

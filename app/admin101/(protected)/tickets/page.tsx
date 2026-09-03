import type { Metadata } from "next";
import Link from "next/link";

import { Badge, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { ticketStatusMeta } from "@/lib/ticket-status";

export const metadata: Metadata = { title: "Admin · Tickets" };

export const dynamic = "force-dynamic";

/**
 * Read-only admin visibility over every customer's support tickets. Replying
 * happens via the existing isStaff-flagged customer-account flow at
 * /dashboard/support — TicketMessage.authorUserId is a real User FK, and the
 * passcode-only admin session has no associated User row to attribute a reply
 * to. This page exists purely so ticket volume/status can be monitored from
 * the same place as everything else.
 */
export default async function AdminTicketsPage() {
  const tickets = await db.ticket.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      user: { select: { email: true, orgName: true } },
      _count: { select: { messages: true } },
    },
  });

  const openCount = tickets.filter((t) => t.status !== "resolved").length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Tickets</h1>
      <p className="mt-1 text-sm text-fg-muted">
        All customer support tickets ({tickets.length}) · {openCount} open or
        in progress. To reply, log in to your staff-flagged account and use{" "}
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
              <Th>Messages</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tickets.map((t) => {
              const meta = ticketStatusMeta(t.status);
              return (
                <tr key={t.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                  <Td>
                    <Link href={`/admin/tickets/${t.id}`} className="block">
                      <div className="font-medium text-fg">{t.user.email}</div>
                      {t.user.orgName && (
                        <div className="text-xs text-fg-muted">{t.user.orgName}</div>
                      )}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/admin/tickets/${t.id}`} className="text-fg hover:underline">
                      {t.subject}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </Td>
                  <Td className="text-fg-muted">{t._count.messages}</Td>
                  <Td className="text-fg-muted">
                    {t.updatedAt.toLocaleString()}
                  </Td>
                </tr>
              );
            })}
            {tickets.length === 0 && (
              <tr>
                <Td colSpan={5} className="text-center text-fg-muted">
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

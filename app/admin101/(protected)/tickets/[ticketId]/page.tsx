import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui";
import { db } from "@/lib/db";
import { ticketStatusMeta } from "@/lib/ticket-status";

export const metadata: Metadata = { title: "Admin · Ticket" };

export const dynamic = "force-dynamic";

export default async function AdminTicketThreadPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { email: true, orgName: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { email: true, orgName: true } } },
      },
    },
  });
  if (!ticket) notFound();

  const meta = ticketStatusMeta(ticket.status);

  return (
    <div>
      <Link href="/admin101/tickets" className="text-sm text-brand-600 hover:underline dark:text-brand-400">
        ← Back to tickets
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {ticket.user.email}
            {ticket.user.orgName ? ` · ${ticket.user.orgName}` : ""}
          </p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Read-only. To reply or change status, log in to your staff-flagged
        account and open this ticket from the regular dashboard&apos;s Support
        section.
      </p>

      <div className="mt-6 space-y-3">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className="rounded-xl border border-border bg-bg-elevated p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-fg">
                {m.authorIsStaff ? "Staff" : m.author.orgName ?? m.author.email}
              </span>
              <span className="text-xs text-fg-muted">
                {m.createdAt.toLocaleString()}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{m.body}</p>
          </div>
        ))}
        {ticket.messages.length === 0 && (
          <p className="text-sm text-fg-muted">No messages yet.</p>
        )}
      </div>
    </div>
  );
}

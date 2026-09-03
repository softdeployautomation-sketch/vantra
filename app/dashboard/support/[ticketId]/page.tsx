import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TicketThreadClient, type TicketView } from "@/components/ticket-thread-client";
import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser, getDisplayOrgName } from "@/lib/session-user";
import { canAccessTicket } from "@/lib/ticket-authz";

export const metadata: Metadata = { title: "Support ticket" };

export const dynamic = "force-dynamic";

export default async function TicketThreadPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (!user.emailVerified) redirect(`/verify?email=${encodeURIComponent(user.email)}`);
  const org = await getActiveOrganization(user);
  if (!org?.name) redirect("/onboarding");

  // IDOR guard — same fail-closed 404 approach as devices/[agentId].
  const allowed = await canAccessTicket(ticketId, user);
  if (!allowed) notFound();

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
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
  if (!ticket) notFound();

  // Serialize Prisma Date objects into plain strings for the client component.
  const serialized: TicketView = {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      body: m.body,
      authorIsStaff: m.authorIsStaff,
      createdAt: m.createdAt.toISOString(),
      author: m.author ? { orgName: getDisplayOrgName(m.author) } : null,
    })),
  };

  return (
    <div>
      <Link href="/dashboard/support" className="text-sm text-brand-600 hover:underline dark:text-brand-400">
        ← Back to support
      </Link>
      <div className="mt-6">
        <TicketThreadClient ticket={serialized} isStaff={user.isStaff} />
      </div>
    </div>
  );
}
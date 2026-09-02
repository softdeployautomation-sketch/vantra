import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TicketListClient } from "@/components/ticket-list-client";
import { getCurrentUser } from "@/lib/session-user";

export const metadata: Metadata = { title: "Support" };

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const user = await getCurrentUser();
  // Parent dashboard layout already gates auth/verify/onboarding; re-check for
  // type-safety so we never render with a null user.
  if (!user) redirect("/login");

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Support tickets</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {user.isStaff
          ? "All customers' tickets (staff view)."
          : "Open a ticket and our team will get back to you."}
      </p>
      <div className="mt-6">
        <TicketListClient isStaff={user.isStaff} />
      </div>
    </div>
  );
}
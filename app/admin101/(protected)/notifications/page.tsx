import type { Metadata } from "next";

import { AdminNotificationsClient } from "@/components/admin/admin-notifications-client";

export const metadata: Metadata = { title: "Admin · Notifications" };

export const dynamic = "force-dynamic";

export default function AdminNotificationsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Notifications</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Audit trail of every email/Telegram send this app attempted.
      </p>
      <div className="mt-6">
        <AdminNotificationsClient />
      </div>
    </div>
  );
}
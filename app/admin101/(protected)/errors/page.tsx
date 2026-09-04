import type { Metadata } from "next";

import { AdminErrorsClient } from "@/components/admin/admin-errors-client";

export const metadata: Metadata = { title: "Admin · Errors" };

export const dynamic = "force-dynamic";

export default function AdminErrorsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Errors</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Every API-route failure that used to only hit console.error — diagnosable here, so
        nothing fails silently. Filter by route or date range; expand a row for the full stack.
      </p>
      <div className="mt-6">
        <AdminErrorsClient />
      </div>
    </div>
  );
}
import type { Metadata } from "next";

import { PlatformStatusTiles } from "@/components/admin/platform-status";

export const metadata: Metadata = { title: "Admin · Platform" };

export const dynamic = "force-dynamic";

// Landing dashboard for the admin panel. Shows a compact product-status summary
// for the two customer-facing platforms that share this box (Vantra + SpaceWorker).
// The full service-control table lives on /admin101/vps.
export default function AdminIndexPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Platform status</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Live up/down summary for the instaweb platforms running on this box.
      </p>
      <div className="mt-6">
        <PlatformStatusTiles />
      </div>
    </div>
  );
}
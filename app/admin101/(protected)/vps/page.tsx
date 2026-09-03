import type { Metadata } from "next";

import {
  AdminVpsClient,
  type ServiceStateView,
  type VpsMetricsView,
} from "@/components/admin/admin-vps-client";
import { getGenerationQueueDepth } from "@/lib/generation-queue";
import { listServiceStates } from "@/lib/services-control";
import { getVpsMetrics } from "@/lib/vps-status";

export const metadata: Metadata = { title: "Admin · VPS" };

export const dynamic = "force-dynamic";

export default async function AdminVpsPage() {
  // Two INDEPENDENT try/catch blocks — a systemctl failure must not null out the
  // metrics (and a metrics failure must not block the services table).
  let initial: VpsMetricsView | null = null;
  try {
    initial = {
      ...(await getVpsMetrics()),
      generationQueue: getGenerationQueueDepth(),
    };
  } catch (err) {
    console.error("getVpsMetrics failed:", err);
  }

  let initialServices: ServiceStateView[] | null = null;
  try {
    initialServices = await listServiceStates();
  } catch (err) {
    console.error("listServiceStates failed:", err);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">VPS</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Live memory, disk, load, and installer-generation queue pressure for the
        box running TRMM, MeshCentral, Vantra, and SpaceWorker. Stop non-critical
        services below to free RAM.
      </p>
      <div className="mt-6">
        <AdminVpsClient initial={initial} initialServices={initialServices} />
      </div>
    </div>
  );
}

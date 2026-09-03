import type { Metadata } from "next";

import { Badge } from "@/components/ui";
import { getSystemStatus } from "@/lib/system-status";

export const metadata: Metadata = { title: "Admin · Status" };

export const dynamic = "force-dynamic";

export default async function AdminStatusPage() {
  const status = await getSystemStatus();
  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">System status</h1>
      <p className="mt-1 text-sm text-fg-muted">
        HTTP reachability + database connectivity that Vantra depends on.
      </p>
      <div className="mt-6 grid max-w-xl gap-3">
        <StatusRow label="Postgres database" ok={status.database} />
        <StatusRow label="TacticalRMM API" ok={status.trmm} />
        <StatusRow label="MeshCentral" ok={status.mesh} />
      </div>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-bg-elevated px-4 py-3 text-sm">
      <span className="font-medium text-fg">{label}</span>
      <Badge tone={ok ? "success" : "danger"}>{ok ? "Reachable" : "Unreachable"}</Badge>
    </div>
  );
}
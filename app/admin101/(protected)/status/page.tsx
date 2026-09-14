import type { Metadata } from "next";

import { Badge } from "@/components/ui";
import { getSystemStatus } from "@/lib/system-status";

export const metadata: Metadata = { title: "Admin · Status" };

export const dynamic = "force-dynamic";

export default async function AdminStatusPage() {
  const status = await getSystemStatus();
  const g = status.generator;
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
        <StatusRow
          label="ZIP / MSI generator (configured)"
          ok={g.configured}
        />
        <StatusRow label="Generator reachable" ok={g.reachable} />
        {g.reachable && (
          <>
            <StatusRow
              label={`Agent payload${g.launcherMode ? ` (${g.launcherMode})` : ""}`}
              ok={g.payloadImported}
            />
            <StatusRow label="Launcher build ready" ok={g.launcherReady} />
          </>
        )}
      </div>

      {g.missing.length > 0 && (
        <div className="mt-6 max-w-xl rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
          <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">
            Generator requisites missing
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800 dark:text-red-300">
            {g.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {g.payloadImported && g.payloadSha256 && (
            <p className="mt-3 font-mono text-xs text-fg-muted">
              payload sha256: {g.payloadSha256}
            </p>
          )}
        </div>
      )}

      {g.missing.length === 0 && g.payloadImported && (
        <p className="mt-6 max-w-xl rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800 dark:border-green-900 dark:bg-green-950/40">
          All generator requirements present.
        </p>
      )}
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
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { isLocalExeRuntime } from "@/lib/exe-runtime";
import { getDeviceView } from "@/lib/local-db/repo";
import { Badge } from "@/components/ui";
import { agentStatusMeta } from "@/lib/agent-status";

export const metadata: Metadata = {
  title: "Device",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Task 44.4 — a thin per-device detail page for the EXE's local devices surface.
// Served only by the bundled runtime (/local/devices/[agentId]). Slim, matching the
// /console precedent — no hosted Shell layout. Renders the local mirror row.
export default async function LocalDeviceDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  if (!agentId || !isLocalExeRuntime()) notFound();

  const device = await getDeviceView(agentId);
  if (!device) notFound();

  const meta = agentStatusMeta(device.status);

  return (
    <main className="flex h-screen flex-col bg-bg" style={{ minHeight: "100vh" }}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg-elevated px-5">
        <span className="text-sm font-bold text-brand-600 dark:text-brand-400">Vantra</span>
        <Link
          href="/local/devices"
          className="text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          ← Back to devices
        </Link>
      </header>

      <div className="mx-auto w-full max-w-2xl p-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold text-fg">{device.hostname}</h1>
            <p className="mt-1 text-sm text-fg-muted">
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-muted">Agent ID</dt>
            <dd className="mt-1 break-all font-mono text-sm text-fg">{device.agent_id}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-muted">Label</dt>
            <dd className="mt-1 text-sm text-fg">{device.label ?? <span className="text-fg-muted">—</span>}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-muted">Last seen</dt>
            <dd className="mt-1 text-sm text-fg">{device.last_seen}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-muted">Site</dt>
            <dd className="mt-1 text-sm text-fg">{device.siteName ?? <span className="text-fg-muted">—</span>}</dd>
          </div>
        </dl>

        <div className="mt-6">
          <Badge tone="neutral">Stored locally</Badge>
        </div>
      </div>
    </main>
  );
}
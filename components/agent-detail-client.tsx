"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppsPanel, ProcessesPanel, ServicesPanel } from "@/components/backstage";
import { ConfirmDialog } from "@/components/modal";
import { RemoteTools } from "@/components/remote-tools";
import { RemoteToolsLocked } from "@/components/remote-tools-locked";
import { ScriptManager } from "@/components/script-manager";
import { Tabs, type TabItem } from "@/components/tabs";
import { Badge, Button, Card, Spinner, Td, Table } from "@/components/ui";
import { agentStatusMeta } from "@/lib/agent-status";
import { formatRelativeTime } from "@/lib/relative-time";

interface AgentDetailResponse {
  agent_id?: string;
  status?: string;
  hostname?: string;
  operating_system?: string;
  last_seen?: string;
  needs_reboot?: boolean;
  monitoring_type?: string;
  logged_in_username?: string;
  public_ip?: string;
  description?: string;
  checks?: { total?: number; passing?: number; failing?: number; warning?: number };
  [key: string]: unknown;
}

export function AgentDetailClient({
  agentId,
  plan,
  isStaff,
}: {
  agentId: string;
  plan: string;
  isStaff: boolean;
}) {
  const [agent, setAgent] = useState<AgentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reboot" | "shutdown" | null>(null);
  const [actionRunning, setActionRunning] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let active = true;
    fetch(`/api/devices/${encodeURIComponent(agentId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setAgent(data.agent ?? null);
      })
      .catch(() => {
        if (active) setError("Network error while loading device details.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agentId]);

  const isPremium = plan === "premium";

  async function runDestructive(kind: "reboot" | "shutdown") {
    setActionRunning(true);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(agentId)}/${kind}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Couldn't send the ${kind} command.`);
      }
    } catch {
      setError("Network error while sending the command.");
    } finally {
      setActionRunning(false);
      setConfirm(null);
    }
  }

  async function runPing() {
    setPinging(true);
    setPingResult(null);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(agentId)}/ping`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPingResult(`Error: ${data.error ?? res.status}`);
        return;
      }
      const p = data.ping ?? {};
      setPingResult(`${p.name ?? "device"}: ${p.status ?? "unknown"}`);
    } catch {
      setPingResult("Error: network failure.");
    } finally {
      setPinging(false);
    }
  }

  if (loading && !agent) {
    return (
      <div className="flex items-center justify-center py-20 text-fg-muted">
        <Spinner className="mr-2" /> Loading device…
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error ?? "Device not found."}
      </div>
    );
  }

  const meta = agentStatusMeta(agent.status);

  const tabs: TabItem[] = [
    {
      key: "overview",
      label: "Overview",
      content: <OverviewPanel agent={agent} agentId={agentId} />,
    },
    {
      key: "scripts",
      label: "Scripts",
      content: <ScriptManager agentId={agentId} />,
    },
    // Task Manager / Services / Software were previously buried three clicks
    // deep inside Remote Tools → Backstage (Premium-gated). Surfaced here as
    // first-class tabs so a free-tier evaluator can SEE the real telemetry.
    // Reads are now free-tier (ownership-checked); actions stay Premium.
    {
      key: "task-manager",
      label: "Task Manager",
      content: <ProcessesPanel agentId={agentId} readOnly={!isPremium} active={tab === "task-manager"} />,
    },
    {
      key: "services",
      label: "Services",
      content: <ServicesPanel agentId={agentId} readOnly={!isPremium} active={tab === "services"} />,
    },
    {
      key: "software",
      label: "Software",
      content: <AppsPanel agentId={agentId} readOnly={!isPremium} active={tab === "software"} />,
    },
    // Remote Tools is a Premium customer feature — always present (not
    // staff-gated). Premium viewers get the tools; everyone else sees a locked
    // upsell card so the feature's existence stays visible.
    {
      key: "remote",
      label: "Remote Tools",
      content:
        plan === "premium" ? (
          <RemoteTools agentId={agentId} isStaff={isStaff} />
        ) : (
          <RemoteToolsLocked />
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-fg">{agent.hostname}</h1>
            <Badge tone={meta.tone} title={meta.description}>{meta.label}</Badge>
          </div>
          <p className="mt-1 font-mono text-xs text-fg-muted" title={agent.agent_id ?? agentId}>
            agent id &middot; {shortId(agent.agent_id ?? agentId)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={runPing}
            disabled={pinging || !isPremium}
            title={isPremium ? undefined : "Requires Premium"}
            type="button"
          >
            {pinging && <Spinner />} Ping
          </Button>
          <Button
            variant="danger"
            onClick={() => setConfirm("reboot")}
            disabled={!isPremium}
            title={isPremium ? undefined : "Requires Premium"}
            type="button"
          >
            Reboot
          </Button>
          <Button
            variant="danger"
            onClick={() => setConfirm("shutdown")}
            disabled={!isPremium}
            title={isPremium ? undefined : "Requires Premium"}
            type="button"
          >
            Shutdown
          </Button>
        </div>
      </div>

      {!isPremium && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-900/20 dark:text-brand-200">
          <span>Ping, Reboot and Shutdown require Premium.</span>
          <Link
            href="/dashboard/settings#wallet"
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Add funds &amp; activate Premium
          </Link>
        </div>
      )}

      {pingResult && (
        <p className="text-sm text-fg-muted">Ping result: <span className="font-medium">{pingResult}</span></p>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <ConfirmDialog
        open={confirm === "reboot"}
        onClose={() => setConfirm(null)}
        onConfirm={() => runDestructive("reboot")}
        title="Reboot this device?"
        description={`This will reboot "${agent.hostname}". Any unsaved work on the machine will be lost. This can't be cancelled once sent.`}
        confirmLabel="Reboot"
        confirming={actionRunning}
      />
      <ConfirmDialog
        open={confirm === "shutdown"}
        onClose={() => setConfirm(null)}
        onConfirm={() => runDestructive("shutdown")}
        title="Shut down this device?"
        description={`This will shut down "${agent.hostname}". The machine will not come back until someone powers it on. This can't be cancelled once sent.`}
        confirmLabel="Shut down"
        confirming={actionRunning}
      />
    </div>
  );
}

// Display helper: trims a long agent id down to the design canvas side's
// compact "8f2c…a13e" form. The full id is still available via `title`.
function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

function OverviewPanel({
  agent,
  agentId,
}: {
  agent: AgentDetailResponse;
  agentId: string;
}) {
  const checks = agent.checks;
  return (
    <div className="max-w-3xl space-y-6">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-fg">Device info</h2>
        <div className="mt-3 overflow-x-auto">
          <Table>
            <tbody className="divide-y divide-border">
              <Row k="Operating system" v={agent.operating_system ?? "—"} />
              <Row k="Monitoring type" v={agent.monitoring_type ?? "—"} />
              <Row
                k="Last seen"
                v={agent.last_seen ? formatRelativeTime(agent.last_seen) : "—"}
              />
              <Row k="Logged in user" v={agent.logged_in_username ?? "—"} />
              <Row k="Public IP" v={agent.public_ip ?? "—"} />
              <Row k="Total RAM" v={formatRam(agent.total_ram)} />
              <Row k="Disks" v={formatDisks(agent.disks)} />
              <Row k="Needs reboot" v={agent.needs_reboot ? "Yes" : "No"} />
              <Row k="Description" v={agent.description ?? "—"} />
            </tbody>
          </Table>
        </div>
      </Card>

      {/* Read-only preview strip — surfacing telemetry a free-tier user can SEE
          without Premium. The full management UIs live in their own tabs. */}
      <GlanceStrip agentId={agentId} />

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-fg">Monitoring checks</h2>
        {checks ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total" value={checks.total ?? 0} />
            <Stat label="Passing" value={checks.passing ?? 0} tone="emerald" />
            <Stat label="Warning" value={checks.warning ?? 0} tone="amber" />
            <Stat label="Failing" value={checks.failing ?? 0} tone="red" />
          </div>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">No check data reported.</p>
        )}
      </Card>
    </div>
  );
}

interface GlanceData {
  softwareCount: number;
  runningServices: number;
  topProcess: { name: string; cpu: string } | null;
}

// Lite read-only preview: installed-software count, running-services count, and
// the single top process by CPU. Calls the existing list endpoints (reads are
// now free-tier / ownership-checked). Failures degrade gracefully to a message
// rather than crashing the Overview tab.
function GlanceStrip({ agentId }: { agentId: string }) {
  const [data, setData] = useState<GlanceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    const software = fetch(
      `/api/devices/${encodeURIComponent(agentId)}/software`,
    ).then((r) => (r.ok ? r.json().catch(() => ({})) : null));
    const services = fetch(
      `/api/devices/${encodeURIComponent(agentId)}/services`,
    ).then((r) => (r.ok ? r.json().catch(() => ({})) : null));
    const processes = fetch(
      `/api/devices/${encodeURIComponent(agentId)}/processes`,
    ).then((r) => (r.ok ? r.json().catch(() => ({})) : null));

    Promise.all([software, services, processes])
      .then(([sw, svc, prc]) => {
        if (!active) return;
        const swList = Array.isArray(sw?.software) ? (sw.software as AppLike[]) : [];
        const svcList = Array.isArray(svc?.services) ? (svc.services as ServiceLike[]) : [];
        const procList = Array.isArray(prc?.processes)
          ? (prc.processes as ProcLike[])
          : [];
        const top = [...procList].sort(
          (a, b) => parseCpuPct(b.cpu_percent) - parseCpuPct(a.cpu_percent),
        )[0];
        setData({
          softwareCount: swList.length,
          runningServices: svcList.filter((s) => s.status === "Running").length,
          topProcess: top
            ? { name: top.name ?? "Unknown", cpu: formatCpuPct(top.cpu_percent) }
            : null,
        });
      })
      .catch(() => {
        if (active) setError("Couldn't load the at-a-glance preview.");
      });
    return () => {
      active = false;
    };
  }, [agentId]);

  useEffect(() => load(), [load]);

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">At a glance</h2>
      {data ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Software packages" value={data.softwareCount} />
          <Stat label="Running services" value={data.runningServices} />
          <div className="rounded-lg bg-bg-elevated p-3 text-center">
            <div className="truncate text-lg font-bold text-fg" title={data.topProcess?.name}>
              {data.topProcess ? `${data.topProcess.name} · ${data.topProcess.cpu}` : "—"}
            </div>
            <div className="mt-1 text-xs text-fg-muted">Top process by CPU</div>
          </div>
        </div>
      ) : error ? (
        <p className="mt-2 text-sm text-fg-muted">{error}</p>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">
          <Spinner className="mr-2" /> Loading preview…
        </p>
      )}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <Td className="text-fg-muted">{k}</Td>
      <Td>{v}</Td>
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" | "red" }) {
  // Tinted, borderless cards per the design canvas — neutral Total uses the
  // elevated background, status cards get a translucent tint in their own color.
  const bg = {
    emerald: "bg-emerald-500/10",
    amber: "bg-amber-500/10",
    red: "bg-red-500/10",
    none: "bg-bg-elevated",
  }[tone ?? "none"];
  const color = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    none: "text-fg",
  }[tone ?? "none"];
  return (
    <div className={`rounded-lg ${bg} p-3 text-center`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className={tone ? `mt-1 text-xs font-semibold ${color}` : "mt-1 text-xs text-fg-muted"}>
        {label}
      </div>
    </div>
  );
}

// --- At-a-glance / overview formatting helpers -------------------------------

// Structural copies of the list items returned by the processes/software/services
// read endpoints (kept deliberately loose — these are read-only preview shapes).
interface ProcLike {
  name?: string;
  pid?: number;
  cpu_percent?: unknown;
  membytes?: number;
  username?: string;
}
interface ServiceLike {
  name: string;
  displayName?: string;
  status: string;
  startType?: string;
}
interface AppLike {
  name: string;
  version?: string;
  publisher?: string;
  size?: string;
}

/** Parses a value that may be a number, a "12.5" string, or a "12.5%" string. */
function parseCpuPct(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace("%", "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Formats a CPU percentage for display, tolerating already-formatted strings. */
function formatCpuPct(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return `${v}%`;
  if (typeof v === "string") return /%$/.test(v.trim()) ? v.trim() : `${v.trim()}%`;
  return "—";
}

function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${Math.round(n / (1 << 20))} MB`;
  return `${Math.round(n)} bytes`;
}

/** Reports total RAM (TRMM sends bytes; some payloads may already be GB-scale). */
function formatRam(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return "—";
  return formatBytes(v);
}

/** Reads a byte count off a disk object across the plausible field names. */
function diskBytes(d: unknown): number {
  if (typeof d !== "object" || d === null) return 0;
  const o = d as Record<string, unknown>;
  for (const key of ["size", "total", "total_bytes", "capacity", "bytes_total"]) {
    const n = o[key];
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Renders the disk summary defensively — the exact live TRMM shape for `disks`
 *  hasn't been verified in the UI yet, so we never assume a particular field. */
function formatDisks(v: unknown): string {
  const list = Array.isArray(v)
    ? v
    : typeof v === "object" && v !== null && Array.isArray((v as { disks?: unknown }).disks)
      ? (v as { disks: unknown[] }).disks
      : null;
  if (!list || list.length === 0) return "—";
  const total = list.reduce((acc, d) => acc + diskBytes(d), 0);
  const countLabel = `${list.length} disk${list.length === 1 ? "" : "s"}`;
  return total > 0 ? `${countLabel} · ${formatBytes(total)}` : countLabel;
}
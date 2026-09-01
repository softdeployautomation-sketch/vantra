"use client";

import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/modal";
import { RemoteTools } from "@/components/remote-tools";
import { Badge, Button, Card, Spinner, Td, Table } from "@/components/ui";

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

const STATUS_META: Record<string, { tone: "success" | "danger" | "warning"; label: string }> = {
  online: { tone: "success", label: "Online" },
  offline: { tone: "danger", label: "Offline" },
  overdue: { tone: "warning", label: "Overdue" },
};

export function AgentDetailClient({ agentId, isStaff }: { agentId: string; isStaff: boolean }) {
  const [agent, setAgent] = useState<AgentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reboot" | "shutdown" | null>(null);
  const [actionRunning, setActionRunning] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

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

  const meta = STATUS_META[agent.status ?? ""] ?? STATUS_META.offline;
  const checks = agent.checks;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-fg">{agent.hostname}</h1>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          <p className="mt-1 font-mono text-xs text-fg-muted">{agent.agent_id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={runPing} disabled={pinging} type="button">{pinging && <Spinner />} Ping</Button>
          <Button variant="danger" onClick={() => setConfirm("reboot")} type="button">Reboot</Button>
          <Button variant="danger" onClick={() => setConfirm("shutdown")} type="button">Shutdown</Button>
        </div>
      </div>

      {pingResult && (
        <p className="text-sm text-fg-muted">Ping result: <span className="font-medium">{pingResult}</span></p>
      )}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-fg">Device info</h2>
        <div className="mt-3 overflow-x-auto">
          <Table>
            <tbody className="divide-y divide-gray-100">
              <Row k="Operating system" v={agent.operating_system ?? "—"} />
              <Row k="Monitoring type" v={agent.monitoring_type ?? "—"} />
              <Row k="Last seen" v={agent.last_seen ?? "—"} />
              <Row k="Logged in user" v={agent.logged_in_username ?? "—"} />
              <Row k="Public IP" v={agent.public_ip ?? "—"} />
              <Row k="Needs reboot" v={agent.needs_reboot ? "Yes" : "No"} />
              <Row k="Description" v={agent.description ?? "—"} />
            </tbody>
          </Table>
        </div>
      </Card>

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

      {isStaff && <RemoteTools agentId={agentId} />}

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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <Td className="text-fg-muted">{k}</Td>
      <Td>{v}</Td>
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" | "red" }) {
  const color = {
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
    none: "text-fg",
  }[tone ?? "none"];
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-fg-muted">{label}</div>
    </div>
  );
}
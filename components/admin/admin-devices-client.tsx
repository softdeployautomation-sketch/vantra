"use client";

import { useState } from "react";

import { Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { MoveDeviceButton } from "@/components/move-device-button";

export type AdminDeviceOrgRow = {
  orgId: string;
  orgName: string;
  ownerEmail: string;
  trmmClientId: number;
};

type Device = {
  agentId: string;
  hostname: string;
  status: "online" | "offline" | "overdue";
  lastSeen: string;
  operatingSystem: string;
};

type CmdResult = { agentId: string; ok: boolean; output?: string; error?: string };

async function json(res: Response) {
  return res.json().catch(() => ({}));
}

// Task 44 req #11 — admin bulk remote cmd/PowerShell execution, single
// customer's device set at a time, never cross-customer. Deliberately kept
// off the admin sidebar nav (see the page.tsx comment); this component adds
// a second, in-page layer — nothing below the plain checkbox at the top
// renders until it's checked.
export function AdminDevicesClient({ orgs }: { orgs: AdminDeviceOrgRow[] }) {
  const [revealed, setRevealed] = useState(false);
  const [orgQuery, setOrgQuery] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const [cmd, setCmd] = useState("");
  const [shell, setShell] = useState<"cmd" | "powershell">("cmd");
  const [runAsUser, setRunAsUser] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CmdResult[] | null>(null);

  const selectedOrg = orgs.find((o) => o.orgId === selectedOrgId) ?? null;
  const filteredOrgs = orgQuery.trim()
    ? orgs.filter(
        (o) =>
          o.ownerEmail.toLowerCase().includes(orgQuery.trim().toLowerCase()) ||
          o.orgName.toLowerCase().includes(orgQuery.trim().toLowerCase()),
      )
    : orgs;

  async function loadDevices(orgId: string) {
    setSelectedOrgId(orgId);
    setDevices(null);
    setSelectedAgentIds(new Set());
    setResults(null);
    setError("");
    setLoadingDevices(true);
    try {
      const res = await fetch(`/api/admin/devices?orgId=${encodeURIComponent(orgId)}`);
      const data = await json(res);
      if (!res.ok) {
        setError(data.error ?? "Couldn't load devices.");
        setDevices([]);
        return;
      }
      setDevices(data.devices ?? []);
    } catch {
      setError("Network error loading devices.");
      setDevices([]);
    } finally {
      setLoadingDevices(false);
    }
  }

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  function toggleAll() {
    if (!devices) return;
    setSelectedAgentIds((prev) =>
      prev.size === devices.length ? new Set() : new Set(devices.map((d) => d.agentId)),
    );
  }

  async function run() {
    if (!selectedOrg || selectedAgentIds.size === 0 || !cmd.trim()) return;
    const count = selectedAgentIds.size;
    if (
      !window.confirm(
        `Run this ${shell} command on ${count} device${count === 1 ? "" : "s"} belonging to ${selectedOrg.ownerEmail}?\n\n${cmd.trim()}\n\nThis runs immediately — there's no undo.`,
      )
    ) {
      return;
    }
    setRunning(true);
    setError("");
    setResults(null);
    try {
      const res = await fetch("/api/admin/devices/bulk-cmd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: selectedOrg.orgId,
          agentIds: Array.from(selectedAgentIds),
          cmd: cmd.trim(),
          shell,
          runAsUser,
        }),
      });
      const data = await json(res);
      if (!res.ok) {
        setError(data.error ?? "Couldn't run the command.");
        return;
      }
      setResults(data.results ?? []);
    } catch {
      setError("Network error running the command.");
    } finally {
      setRunning(false);
    }
  }

  if (!revealed) {
    return (
      <label className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-sm text-fg-muted">
        <input
          type="checkbox"
          checked={revealed}
          onChange={(e) => setRevealed(e.target.checked)}
          className="h-4 w-4"
        />
        Show
      </label>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-fg-muted">
        <input
          type="checkbox"
          checked={revealed}
          onChange={(e) => setRevealed(e.target.checked)}
          className="h-4 w-4"
        />
        Show
      </label>

      <Card className="p-4">
        <Label htmlFor="org-search">Customer</Label>
        <Input
          id="org-search"
          value={orgQuery}
          onChange={(e) => setOrgQuery(e.target.value)}
          placeholder="Search by email or org name"
          autoComplete="off"
          className="mt-1"
        />
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border">
          {filteredOrgs.length === 0 ? (
            <p className="p-3 text-sm text-fg-muted">No matching customers.</p>
          ) : (
            filteredOrgs.map((o) => (
              <button
                key={o.orgId}
                type="button"
                onClick={() => void loadDevices(o.orgId)}
                className={`flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-black/5 dark:hover:bg-white/5 ${
                  selectedOrgId === o.orgId ? "bg-black/5 dark:bg-white/5" : ""
                }`}
              >
                <span>{o.ownerEmail}</span>
                <span className="text-xs text-fg-muted">{o.orgName}</span>
              </button>
            ))
          )}
        </div>
      </Card>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {selectedOrg && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">
              {selectedOrg.ownerEmail}&apos;s devices
            </h2>
            {loadingDevices && <Spinner className="h-4 w-4" />}
          </div>

          {devices && devices.length > 0 ? (
            <>
              <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-border">
                <div className="flex items-center gap-2 border-b border-border bg-black/5 px-3 py-2 text-xs font-medium text-fg-muted dark:bg-white/5">
                  <input
                    type="checkbox"
                    checked={devices.length > 0 && selectedAgentIds.size === devices.length}
                    onChange={toggleAll}
                    className="h-4 w-4"
                  />
                  Select all ({devices.length})
                </div>
                {devices.map((d) => (
                  <div
                    key={d.agentId}
                    className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAgentIds.has(d.agentId)}
                      onChange={() => toggleAgent(d.agentId)}
                      className="h-4 w-4"
                    />
                    <span className="flex-1">{d.hostname}</span>
                    <Badge tone={d.status === "online" ? "success" : "warning"}>{d.status}</Badge>
                    <span className="text-xs text-fg-muted">{d.operatingSystem}</span>
                    {/* Task 63: admin branch of the one-click move — sourceOrgId
                        is the org selected above (admin acts on ANY device). */}
                    {selectedOrg && (
                      <MoveDeviceButton agentId={d.agentId} sourceOrgId={selectedOrg.orgId} />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[120px_1fr]">
                <div>
                  <Label htmlFor="shell">Shell</Label>
                  <select
                    id="shell"
                    value={shell}
                    onChange={(e) => setShell(e.target.value as "cmd" | "powershell")}
                    className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  >
                    <option value="cmd">cmd</option>
                    <option value="powershell">PowerShell</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="cmd">Command</Label>
                  <textarea
                    id="cmd"
                    value={cmd}
                    onChange={(e) => setCmd(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs"
                    placeholder="e.g. Restart-Service -Name Spooler"
                  />
                </div>
              </div>

              <label className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={runAsUser}
                  onChange={(e) => setRunAsUser(e.target.checked)}
                  className="h-4 w-4"
                />
                Run as the logged-in user (may be visible on their screen — leave off to run silently in the background)
              </label>

              <Button
                className="mt-3"
                onClick={() => void run()}
                disabled={running || selectedAgentIds.size === 0 || !cmd.trim()}
              >
                {running ? <Spinner className="h-4 w-4" /> : null}
                Run on {selectedAgentIds.size} device{selectedAgentIds.size === 1 ? "" : "s"}
              </Button>
            </>
          ) : devices && devices.length === 0 ? (
            <p className="mt-3 text-sm text-fg-muted">No devices for this customer.</p>
          ) : null}

          {results && (
            <div className="mt-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Results</h3>
              {results.map((r) => (
                <div key={r.agentId} className="rounded-lg border border-border bg-bg p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={r.ok ? "success" : "danger"}>{r.ok ? "ok" : "failed"}</Badge>
                    <span className="font-mono">{r.agentId}</span>
                  </div>
                  {r.output && <pre className="mt-1 whitespace-pre-wrap break-all">{r.output}</pre>}
                  {r.error && <p className="mt-1 text-red-600 dark:text-red-400">{r.error}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

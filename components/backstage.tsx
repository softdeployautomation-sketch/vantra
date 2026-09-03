"use client";

import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/modal";
import { Tabs, type TabItem } from "@/components/tabs";
import { Badge, Button, Input, Spinner, Td, Th, Table } from "@/components/ui";
import { useToast } from "@/components/toast";

// Structural copies of the lib/trmm.ts server-side types - the client can't
// import server-only code, so keep these in sync by hand (same pattern used by
// the admin components and the ScriptManager).

type ServiceAction = "start" | "stop" | "restart";

interface WinService {
  name: string;
  displayName: string;
  status: string; // already human-readable ("Running" | "Stopped" | ...)
  startType: string; // "Automatic" | "Manual" | "Disabled" | ...
}

interface Proc {
  name: string;
  pid: number;
  membytes: number;
  username: string;
  cpu_percent: string;
}

interface App {
  name: string;
  size: string;
  source: string;
  version: string;
  location: string;
  publisher: string;
  uninstall: string;
  install_date: string;
}

function formatMb(bytes: number): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Parses a JSON response body, throwing the server's `error` string on non-2xx. */
async function parseRes<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

/**
 * "Backstage" - GUI-free admin tooling for a remote device. Lives inside the
 * existing Remote Tools tab. Its own internal tabs: Terminal (relocated from
 * remote-tools, passed in as the `terminal` node so its logic stays untouched),
 * Services, Processes, Apps.
 */
export function Backstage({
  agentId,
  terminal,
}: {
  agentId: string;
  terminal: React.ReactNode;
}) {
  const [tab, setTab] = useState("terminal");
  const tabs: TabItem[] = [
    { key: "terminal", label: "Terminal", content: terminal },
    { key: "services", label: "Services", content: <ServicesPanel agentId={agentId} /> },
    { key: "processes", label: "Processes", content: <ProcessesPanel agentId={agentId} /> },
    { key: "apps", label: "Apps", content: <AppsPanel agentId={agentId} /> },
  ];
  return <Tabs tabs={tabs} active={tab} onChange={setTab} />;
}

function ServiceStatusBadge({ status }: { status: string }) {
  const tone =
    status === "Running" ? "success" : status === "Paused" ? "warning" : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}

// --- Services ----------------------------------------------------------------
function ServicesPanel({ agentId }: { agentId: string }) {
  const toast = useToast();
  const [services, setServices] = useState<WinService[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [confirm, setConfirm] = useState<{
    name: string;
    action: ServiceAction;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch(`/api/devices/${encodeURIComponent(agentId)}/services`)
      .then((r) => parseRes<{ services?: WinService[] }>(r))
      .then((data) => {
        setServices(data.services ?? []);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Couldn't list services."),
      )
      .finally(() => setLoading(false));
  }, [agentId]);

  // Fetch on mount, cache in state; refresh is manual (listing ~200 Windows
  // services takes a couple of seconds over the agent NATS round-trip).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(name: string, action: ServiceAction) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(agentId)}/services/${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? `Couldn't ${action} ${name}.`, "error");
        return;
      }
      toast.push(`Sent ${action} for ${name}.`, "success");
    } catch {
      toast.push("Network error while controlling the service.", "error");
    } finally {
      setBusy(false);
      setConfirm(null);
      void refresh();
    }
  }
const lower = filter.trim().toLowerCase();
  const filtered = (services ?? []).filter(
    (s) =>
      !lower ||
      s.name.toLowerCase().includes(lower) ||
      s.displayName.toLowerCase().includes(lower),
  );

  const actionTitle = confirm
    ? `${confirm.action === "start" ? "Start" : confirm.action === "stop" ? "Stop" : "Restart"} ${confirm.name}?`
    : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter services"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <Button
          variant="secondary"
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          disabled={loading}
          type="button"
        >
          {loading && <Spinner />} Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Display Name</Th>
              <Th>Status</Th>
              <Th>Start Type</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((s) => (
              <tr key={s.name}>
                <Td className="font-medium text-fg">{s.name}</Td>
                <Td className="text-fg-muted">{s.displayName}</Td>
                <Td>
                  <ServiceStatusBadge status={s.status} />
                </Td>
                <Td className="text-fg-muted">{s.startType}</Td>
                <Td className="text-right">
                  {s.status === "Running" ? (
                    <div className="flex justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        className="px-2.5 py-1.5 text-xs"
                        disabled={busy}
                        onClick={() => setConfirm({ name: s.name, action: "stop" })}
                      >
                        Stop
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="px-2.5 py-1.5 text-xs"
                        disabled={busy}
                        onClick={() => setConfirm({ name: s.name, action: "restart" })}
                      >
                        Restart
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-2.5 py-1.5 text-xs"
                      disabled={busy}
                      onClick={() => setConfirm({ name: s.name, action: "start" })}
                    >
                      Start
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
            {services === null && (
              <tr>
                <Td colSpan={5} className="text-center text-fg-muted">
                  Loading services…
                </Td>
              </tr>
            )}
            {!loading && services !== null && filtered.length === 0 && (
              <tr>
                <Td colSpan={5} className="text-center text-fg-muted">
                  No services match.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => !busy && setConfirm(null)}
        onConfirm={() => confirm && void act(confirm.name, confirm.action)}
        title={actionTitle}
        description={
          confirm
            ? `This will ${confirm.action} the ${confirm.name} service on the device. Confirm this is the service you intend to manage.`
            : ""
        }
        confirmLabel={
          confirm
            ? confirm.action.charAt(0).toUpperCase() + confirm.action.slice(1)
            : ""
        }
        confirmVariant="danger"
        confirming={busy}
      />
    </div>
  );
}
// --- Processes ---------------------------------------------------------------
function ProcessesPanel({ agentId }: { agentId: string }) {
  const toast = useToast();
  const [procs, setProcs] = useState<Proc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmPid, setConfirmPid] = useState<number | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch(`/api/devices/${encodeURIComponent(agentId)}/processes`)
      .then((r) => parseRes<{ processes?: Proc[] }>(r))
      .then((data) => {
        setProcs(data.processes ?? []);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Couldn't list processes."),
      )
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function kill() {
    const pid = confirmPid;
    if (pid === null) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(agentId)}/processes/${pid}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't end that process.", "error");
        return;
      }
      toast.push(`Process ${pid} ended.`, "success");
    } catch {
      toast.push("Network error while ending the process.", "error");
    } finally {
      setBusy(false);
      setConfirmPid(null);
      setConfirmName("");
      void refresh();
    }
  }
return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          disabled={loading}
          type="button"
        >
          {loading && <Spinner />} Refresh
        </Button>
        <span className="text-xs text-fg-muted">Task-manager snapshot, fetched on demand.</span>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>PID</Th>
              <Th>User</Th>
              <Th>Memory</Th>
              <Th>CPU%</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(procs ?? []).map((p) => (
              <tr key={p.pid}>
                <Td className="font-medium text-fg">{p.name}</Td>
                <Td>{p.pid}</Td>
                <Td className="text-fg-muted">{p.username}</Td>
                <Td className="text-fg-muted">{formatMb(p.membytes)}</Td>
                <Td className="text-fg-muted">{p.cpu_percent}%</Td>
                <Td className="text-right">
                  <Button
                    type="button"
                    variant="danger"
                    className="px-2.5 py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => {
                      setConfirmPid(p.pid);
                      setConfirmName(p.name);
                    }}
                  >
                    End process
                  </Button>
                </Td>
              </tr>
            ))}
            {procs === null && (
              <tr>
                <Td colSpan={6} className="text-center text-fg-muted">
                  Loading processes…
                </Td>
              </tr>
            )}
            {!loading && procs !== null && procs.length === 0 && (
              <tr>
                <Td colSpan={6} className="text-center text-fg-muted">
                  No processes reported.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>

      <ConfirmDialog
        open={confirmPid !== null}
        onClose={() => !busy && setConfirmPid(null)}
        onConfirm={() => void kill()}
        title="End this process?"
        description={
          confirmPid !== null
            ? `This will terminate ${confirmName} (PID ${confirmPid}) immediately. Any unsaved work it holds will be lost.`
            : ""
        }
        confirmLabel="End process"
        confirmVariant="danger"
        confirming={busy}
      />
    </div>
  );
}
// --- Apps (installed software) ------------------------------------------------
function AppsPanel({ agentId }: { agentId: string }) {
  const toast = useToast();
  const [apps, setApps] = useState<App[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installName, setInstallName] = useState("");
  const [installing, setInstalling] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<App | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/devices/${encodeURIComponent(agentId)}/software`)
      .then((r) => parseRes<{ software?: App[] }>(r))
      .then((data) => {
        setApps(data.software ?? []);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Couldn't list installed software."),
      )
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(agentId)}/software`, {
        method: "PUT",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't trigger a software scan.");
        return;
      }
      toast.push("Scan triggered on the agent.", "success");
      await load();
    } catch {
      setError("Network error while scanning for software.");
    } finally {
      setScanning(false);
    }
  }

  async function install() {
    const name = installName.trim();
    if (!name) return;
    setInstalling(true);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(agentId)}/software`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Couldn't install ${name}.`);
        return;
      }
      toast.push(`Install of ${name} started.`, "success");
      setInstallName("");
    } catch {
      setError("Network error while installing.");
    } finally {
      setInstalling(false);
    }
  }

  async function doUninstall() {
    const target = uninstallTarget;
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(agentId)}/software/uninstall`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: target.name,
            command: target.uninstall,
            timeout: 60,
            runAsUser: false,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Couldn't uninstall ${target.name}.`);
        return;
      }
      toast.push(`Uninstall of ${target.name} started.`, "success");
      // Re-scan so the list reflects the removal rather than going stale.
      await scan();
    } catch {
      setError("Network error while uninstalling.");
    } finally {
      setBusy(false);
      setUninstallTarget(null);
    }
  }

  const needsScan = apps !== null && apps.length === 0 && !loading && !scanning;
return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-bg-elevated p-4">
        <p className="text-sm text-fg-muted">
          Install via Chocolatey (package name must match exactly, e.g. googlechrome, 7zip)
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={installName}
            onChange={(e) => setInstallName(e.target.value)}
            placeholder="Chocolatey package name"
            className="max-w-xs"
            disabled={installing}
          />
          <Button
            type="button"
            onClick={() => void install()}
            disabled={installing || !installName.trim()}
          >
            {installing && <Spinner />} Install
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void scan()}
            disabled={scanning}
          >
            {scanning && <Spinner />} Scan for installed software
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {needsScan && (
        <p className="text-sm text-fg-muted">
          No installed software found yet. Run the &quot;Scan for installed software&quot; button above to
          populate this list.
        </p>
      )}

      {apps === null && !scanning && (
        <p className="text-sm text-fg-muted">
          <Spinner /> Loading installed software…
        </p>
      )}

      {apps !== null && apps.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Version</Th>
                <Th>Publisher</Th>
                <Th>Size</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {apps.map((a, i) => (
                <tr key={`${a.name}-${i}`}>
                  <Td className="font-medium text-fg">{a.name}</Td>
                  <Td className="text-fg-muted">{a.version}</Td>
                  <Td className="text-fg-muted">{a.publisher}</Td>
                  <Td className="text-fg-muted">{a.size}</Td>
                  <Td className="text-right">
                    <Button
                      type="button"
                      variant="danger"
                      className="px-2.5 py-1.5 text-xs"
                      disabled={busy || !a.uninstall}
                      onClick={() => setUninstallTarget(a)}
                    >
                      Uninstall
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={uninstallTarget !== null}
        onClose={() => !busy && setUninstallTarget(null)}
        onConfirm={() => void doUninstall()}
        title={uninstallTarget ? `Uninstall ${uninstallTarget.name}?` : ""}
        description={
          uninstallTarget
            ? `This will uninstall "${uninstallTarget.name}" using its registered uninstall command. Make sure this is a harmless application you really want to remove.`
            : ""
        }
        confirmLabel="Uninstall"
        confirmVariant="danger"
        confirming={busy}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Spinner, Td, Th } from "@/components/ui";

export interface VpsMetricsView {
  memTotalMb: number;
  memAvailableMb: number;
  memUsedMb: number;
  memUsedPercent: number;
  loadAvg: [number, number, number];
  cpuCount: number;
  diskTotalGb: number;
  diskUsedGb: number;
  diskUsedPercent: number;
  uptimeSeconds: number;
  topProcesses: Array<{
    command: string;
    memPercent: number;
    cpuPercent: number;
    rssMb: number;
  }>;
  generationQueue: { active: number; waiting: number };
}

// Structural copy of lib/services-control.ts types (server-only). Keep in sync
// by hand, same as the existing metrics fields.
export type ServiceAction = "start" | "stop" | "restart";

export interface ServiceStateView {
  unit: string;
  label: string;
  controllable: boolean;
  approxMemMb: number;
  impact: string;
  activeState: string;
  subState: string;
  loadState: string;
  memMb: number | null;
  unknown: boolean;
}

const REFRESH_MS = 15_000;
// Distinct from usageTone()'s 75/90 — that drives bar colour, this drives a CTA.
const MEM_WARN_PERCENT = 80;

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function usageTone(percent: number): "success" | "warning" | "danger" {
  if (percent >= 90) return "danger";
  if (percent >= 75) return "warning";
  return "success";
}

function UsageBar({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  const tone = usageTone(percent);
  const barColor =
    tone === "danger"
      ? "bg-red-500"
      : tone === "warning"
        ? "bg-amber-500"
        : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-fg">{label}</span>
        <span className="text-fg-muted">{detail}</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ServiceStatusBadge({ state }: { state: ServiceStateView }) {
  let tone: "success" | "danger" | "warning" | "neutral";
  let label: string;
  if (state.loadState === "not-found") {
    tone = "warning";
    label = "Not installed";
  } else if (state.unknown) {
    tone = "neutral";
    label = "Unknown";
  } else if (state.activeState === "active") {
    tone = "success";
    label = "Running";
  } else if (state.activeState === "failed") {
    tone = "danger";
    label = "Failed";
  } else if (state.activeState === "activating" || state.activeState === "deactivating") {
    tone = "warning";
    label = cap(state.activeState);
  } else {
    tone = "neutral";
    label = "Stopped";
  }
  return (
    <div>
      <Badge tone={tone}>{label}</Badge>
      <div className="mt-0.5 text-xs text-fg-muted">{state.subState}</div>
    </div>
  );
}

export function AdminVpsClient({
  initial,
  initialServices,
}: {
  initial: VpsMetricsView | null;
  initialServices: ServiceStateView[] | null;
}) {
  const toast = useToast();
  const [metrics, setMetrics] = useState<VpsMetricsView | null>(initial);
  const [services, setServices] = useState<ServiceStateView[] | null>(initialServices);
  const [error, setError] = useState<string | null>(
    initial ? null : "Couldn't load VPS metrics.",
  );
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<
    (ServiceStateView & { action: ServiceAction }) | null
  >(null);
  const [pending, setPending] = useState<string | null>(null); // `${unit}:${action}`
  const mounted = useRef(true);

  const refreshMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vps");
      const data = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!res.ok) {
        setError(data.error ?? "Couldn't load VPS metrics.");
        return;
      }
      setMetrics(data);
      setError(null);
    } catch {
      if (mounted.current) setError("Network error while refreshing VPS metrics.");
    }
  }, []);

  const refreshServices = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/services");
      const data = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!res.ok) {
        setServicesError(data.error ?? "Couldn't load service state.");
        return;
      }
      setServices(data.services ?? null);
      setServicesError(null);
    } catch {
      if (mounted.current)
        setServicesError("Network error while refreshing service state.");
    }
  }, []);

  useEffect(() => {
    mounted.current = true; // set INSIDE the effect (React StrictMode double-mount)
    const id = setInterval(() => {
      // Promise.allSettled — a services 502 must not abort the metrics update.
      void Promise.allSettled([refreshMetrics(), refreshServices()]);
    }, REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refreshMetrics, refreshServices]);

  // start runs immediately (not destructive); stop/restart require the dialog.
  function requestAction(svc: ServiceStateView, action: ServiceAction) {
    if (action === "start") {
      void runAction(svc, "start");
      return;
    }
    setConfirmTarget({ ...svc, action });
  }

  async function runAction(svc: ServiceStateView, action: ServiceAction) {
    setPending(`${svc.unit}:${action}`);
    try {
      const res = await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit: svc.unit, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? `Couldn't ${action} ${svc.label}.`, "error");
        return;
      }
      toast.push(data.message ?? `${svc.label} ${action} successful.`, "success");
      if (data.services) setServices(data.services); // authoritative — table updates now
    } catch {
      toast.push("Network error. Please try again.", "error");
    } finally {
      setPending(null);
      setConfirmTarget(null);
      void refreshServices();
      void refreshMetrics(); // the payoff: the Memory bar visibly drops within a second
    }
  }

  // --- Derived values for banners, the Services table, and the confirm dialog ---
  const memUsedPercent = metrics?.memUsedPercent ?? 0;
  const memoryPressure = metrics !== null && memUsedPercent >= MEM_WARN_PERCENT;
  // Live recoverable figure — sum over controllable services that are currently
  // active so it stops promising RAM that stops (or starts) don't back.
  const recoverableMb =
    services?.reduce(
      (sum, s) =>
        s.controllable && s.activeState === "active"
          ? sum + (s.memMb ?? s.approxMemMb)
          : sum,
      0,
    ) ?? 0;

  const stoppedControllable =
    services?.filter(
      (s) =>
        s.controllable &&
        (s.activeState === "inactive" ||
          s.activeState === "failed" ||
          s.activeState === "deactivating"),
    ) ?? [];

  const confirmTitle = confirmTarget
    ? `${cap(confirmTarget.action)} ${confirmTarget.label}?`
    : "";
  const confirmDescription = confirmTarget ? (
    <>
      <p>{confirmTarget.impact}</p>
      <p className="mt-2">
        This frees roughly {confirmTarget.memMb ?? confirmTarget.approxMemMb} MB. Nothing restarts it
        automatically — start it again from this page when you&apos;re done, or it will come back on the
        next reboot.
      </p>
    </>
  ) : null;

  function isPending(svc: ServiceStateView, action: ServiceAction): boolean {
    return pending === `${svc.unit}:${action}`;
  }

  function ActionButtons({ svc }: { svc: ServiceStateView }) {
    const busy = pending !== null;
    const running = svc.activeState === "active";
    const stopped = svc.activeState === "inactive" || svc.activeState === "failed";

    if (!svc.controllable) return <Badge tone="neutral">Protected</Badge>;

    if (running) {
      return (
        <div className="flex justify-end gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={busy}
            onClick={() => requestAction(svc, "restart")}
          >
            {isPending(svc, "restart") && <Spinner />} Restart
          </Button>
          <Button
            type="button"
            variant="danger"
            className="px-2.5 py-1.5 text-xs"
            disabled={busy}
            onClick={() => requestAction(svc, "stop")}
          >
            {isPending(svc, "stop") && <Spinner />} Stop
          </Button>
        </div>
      );
    }

    if (stopped) {
      return (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={busy}
            onClick={() => requestAction(svc, "start")}
          >
            {isPending(svc, "start") && <Spinner />} Start
          </Button>
        </div>
      );
    }

    // transitional / unknown — start operates but we can't see a stable state.
    return (
      <div className="flex justify-end">
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" disabled>
          {isPending(svc, "start") && <Spinner />} Start
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && metrics === null && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="status">
          {error}
        </div>
      )}

      {memoryPressure && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            memUsedPercent >= 90 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
          }`}
          role="status"
        >
          Memory is at <strong>{memUsedPercent}%</strong> used ({metrics.memUsedMb} /{" "}
          {metrics.memTotalMb} MB). Stopping a non-critical service below would free roughly{" "}
          <strong>{recoverableMb} MB</strong> right now. TacticalRMM&apos;s API stays up either way, so
          agents keep checking in.
        </div>
      )}

      {metrics && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <UsageBar
              label="Memory"
              percent={metrics.memUsedPercent}
              detail={`${metrics.memUsedMb} MB / ${metrics.memTotalMb} MB (${metrics.memUsedPercent}%)`}
            />
          </Card>
          <Card className="p-4">
            <UsageBar
              label="Disk"
              percent={metrics.diskUsedPercent}
              detail={`${metrics.diskUsedGb} GB / ${metrics.diskTotalGb} GB (${metrics.diskUsedPercent}%)`}
            />
          </Card>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-sm font-medium text-fg">Load average</div>
          <div className="mt-2 text-2xl font-bold text-fg">
            {metrics?.loadAvg[0]?.toFixed(2) ?? "—"}
          </div>
          <div className="text-xs text-fg-muted">
            5m: {metrics?.loadAvg[1]?.toFixed(2) ?? "—"} · 15m:{" "}
            {metrics?.loadAvg[2]?.toFixed(2) ?? "—"} · {metrics?.cpuCount ?? "?"} CPUs
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium text-fg">Uptime</div>
          <div className="mt-2 text-2xl font-bold text-fg">
            {metrics ? formatUptime(metrics.uptimeSeconds) : "—"}
          </div>
          <div className="text-xs text-fg-muted">Since the box last rebooted</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium text-fg">Generation queue</div>
          <div className="mt-2 text-2xl font-bold text-fg">
            {metrics?.generationQueue?.active ?? "—"}
            <span className="text-base font-semibold text-fg-muted"> active</span>
          </div>
          <div className="text-xs text-fg-muted">
            {metrics?.generationQueue?.waiting ?? "—"} waiting
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-fg">Services</h2>
          <span className="text-xs text-fg-muted">
            Protected services are read-only and can&apos;t be stopped from here.
          </span>
        </div>

        {stoppedControllable.length > 0 && (
          <div
            className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800"
            role="status"
          >
            {stoppedControllable.map((s) => (
              <p key={s.unit}>
                <strong>{s.label}</strong> is stopped. {s.impact}
              </p>
            ))}
          </div>
        )}

        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="min-w-full divide-y divide-border text-left text-sm">
            <thead>
              <tr>
                <Th>Service</Th>
                <Th>Status</Th>
                <Th>Memory</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(services ?? []).map((svc) => (
                <tr key={svc.unit}>
                  <Td>
                    <span
                      className={
                        svc.controllable
                          ? "font-medium text-fg"
                          : "font-medium text-fg-muted"
                      }
                    >
                      {svc.label}
                    </span>
                  </Td>
                  <Td>
                    <ServiceStatusBadge state={svc} />
                  </Td>
                  <Td className="text-fg-muted">
                    {svc.memMb != null ? <span className="text-fg">{svc.memMb} MB</span> : "—"}
                  </Td>
                  <Td className="text-right">
                    <ActionButtons svc={svc} />
                  </Td>
                </tr>
              ))}
              {services && services.length === 0 && (
                <tr>
                  <Td colSpan={4} className="text-center text-fg-muted">
                    No services.
                  </Td>
                </tr>
              )}
              {services === null && (
                <tr>
                  <Td colSpan={4} className="text-center text-fg-muted">
                    {servicesError ?? "Loading service state…"}
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-xs text-fg-muted">
          Memory shown here is systemd cgroup usage and won&apos;t match the RSS figures in the process
          table above (cgroup includes page cache). Stops are <strong>not permanent</strong> —
          anything enabled comes back on reboot.
        </p>
      </Card>

      <Card className="p-4">
        <div className="mb-3 text-lg font-bold text-fg">Top processes</div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-left text-sm">
            <thead>
              <tr>
                <Th>Process</Th>
                <Th>%MEM</Th>
                <Th>%CPU</Th>
                <Th>RSS</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(metrics?.topProcesses ?? []).map((p, i) => (
                <tr key={i}>
                  <Td className="font-medium">{p.command}</Td>
                  <Td className="text-fg-muted">{p.memPercent.toFixed(1)}%</Td>
                  <Td className="text-fg-muted">{p.cpuPercent.toFixed(1)}%</Td>
                  <Td className="text-fg-muted">{p.rssMb} MB</Td>
                </tr>
              ))}
              {metrics?.topProcesses?.length === 0 && (
                <tr>
                  <Td colSpan={4} className="text-center text-fg-muted">
                    No process data.
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-fg-muted">
        Auto-refreshes every {REFRESH_MS / 1000}s. Data shown is live from this box.
      </p>

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => pending === null && setConfirmTarget(null)}
        onConfirm={() => confirmTarget && void runAction(confirmTarget, confirmTarget.action)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmTarget ? cap(confirmTarget.action) : ""}
        confirmVariant="danger"
        confirming={pending !== null}
      />
    </div>
  );
}

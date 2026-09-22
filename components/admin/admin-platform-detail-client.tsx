"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Spinner, Td, Th } from "@/components/ui";

// Structural copies of the server types (services-control.ts / background-jobs.ts)
// — same hand-maintained-copy convention as admin-vps-client.tsx's ServiceStateView.
export type ServiceAction = "start" | "stop" | "restart";
export type PlatformKey = "vantra" | "spaceworker";

export interface ServiceStateView {
  unit: string;
  label: string;
  platform: "vantra" | "spaceworker" | "shared";
  controllable: boolean;
  approxMemMb: number;
  impact: string;
  activeState: string;
  subState: string;
  loadState: string;
  memMb: number | null;
  unknown: boolean;
}

export interface BackgroundJobView {
  id: string;
  label: string;
  description: string;
  platform: "vantra" | "spaceworker" | "shared";
  timerUnit: string;
  serviceUnit: string;
  schedule: string;
  lastRunAt: string | null;
  lastResult: string | null;
  nextRunAt: string | null;
  timerActive: boolean;
}

const REFRESH_MS = 15_000;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

function JobResultBadge({ result, timerActive }: { result: string | null; timerActive: boolean }) {
  if (result === null) return <Badge tone="neutral">No runs yet</Badge>;
  if (result === "success") return <Badge tone="success">Success</Badge>;
  if (!timerActive) return <Badge tone="neutral">Timer disabled</Badge>;
  return <Badge tone="danger">Failed ({result})</Badge>;
}

interface PlatformMeta {
  title: string;
  subtitle: string;
  liveUrl: string;
  quickLinks: Array<{ href: string; label: string }>;
}

export const PLATFORM_META: Record<PlatformKey, PlatformMeta> = {
  vantra: {
    title: "Vantra",
    subtitle: "Device management platform",
    liveUrl: "https://vantra.spaceworker.top",
    quickLinks: [
      { href: "/admin101/users", label: "Users" },
      { href: "/admin101/payments", label: "Payments" },
      { href: "/admin101/wallets", label: "Wallets" },
      { href: "/admin101/tickets", label: "Tickets" },
    ],
  },
  spaceworker: {
    title: "SpaceWorker",
    subtitle: "Lead extraction & outreach",
    liveUrl: "https://spaceworker.top",
    // SpaceWorker is a separate app with its own database — this admin (Vantra's
    // own Next.js app) has no direct view into its users/campaigns, so there are
    // no admin sub-page links to offer here yet, unlike Vantra's.
    quickLinks: [],
  },
};

export function AdminPlatformDetailClient({
  platform,
  initialServices,
  initialJobs,
}: {
  platform: PlatformKey;
  initialServices: ServiceStateView[] | null;
  initialJobs: BackgroundJobView[] | null;
}) {
  const meta = PLATFORM_META[platform];
  const toast = useToast();
  const [services, setServices] = useState<ServiceStateView[] | null>(initialServices);
  const [jobs, setJobs] = useState<BackgroundJobView[] | null>(initialJobs);
  const [confirmTarget, setConfirmTarget] = useState<(ServiceStateView & { action: ServiceAction }) | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const [svcRes, jobRes] = await Promise.allSettled([
      fetch("/api/admin/services").then((r) => r.json()),
      fetch("/api/admin/background-jobs").then((r) => r.json()),
    ]);
    if (!mounted.current) return;
    if (svcRes.status === "fulfilled" && svcRes.value.services) setServices(svcRes.value.services);
    if (jobRes.status === "fulfilled" && jobRes.value.jobs) setJobs(jobRes.value.jobs);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);

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
      if (data.services) setServices(data.services);
    } catch {
      toast.push("Network error. Please try again.", "error");
    } finally {
      setPending(null);
      setConfirmTarget(null);
      void refresh();
    }
  }

  function isPending(svc: ServiceStateView, action: ServiceAction): boolean {
    return pending === `${svc.unit}:${action}`;
  }

  function ActionButtons({ svc }: { svc: ServiceStateView }) {
    const busy = pending !== null;
    if (!svc.controllable) return <Badge tone="neutral">Protected</Badge>;
    const running = svc.activeState === "active";
    const stopped = svc.activeState === "inactive" || svc.activeState === "failed";

    if (running) {
      return (
        <div className="flex justify-end gap-1.5">
          <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => requestAction(svc, "restart")}>
            {isPending(svc, "restart") && <Spinner />} Restart
          </Button>
          <Button type="button" variant="danger" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => requestAction(svc, "stop")}>
            {isPending(svc, "stop") && <Spinner />} Stop
          </Button>
        </div>
      );
    }
    if (stopped) {
      return (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => requestAction(svc, "start")}>
            {isPending(svc, "start") && <Spinner />} Start
          </Button>
        </div>
      );
    }
    return (
      <div className="flex justify-end">
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" disabled>
          Start
        </Button>
      </div>
    );
  }

  const platformServices = (services ?? []).filter((s) => s.platform === platform);
  const platformJobs = (jobs ?? []).filter((j) => j.platform === platform);

  const confirmTitle = confirmTarget ? `${cap(confirmTarget.action)} ${confirmTarget.label}?` : "";
  const confirmDescription = confirmTarget ? (
    <>
      <p>{confirmTarget.impact}</p>
      <p className="mt-2">
        This frees roughly {confirmTarget.memMb ?? confirmTarget.approxMemMb} MB. Start it again from
        this page when you&apos;re done.
      </p>
    </>
  ) : null;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-fg">{meta.title}</h2>
            <p className="text-sm text-fg-muted">{meta.subtitle}</p>
          </div>
          <a
            href={meta.liveUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Open {meta.liveUrl.replace("https://", "")} ↗
          </a>
        </div>
        {meta.quickLinks.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {meta.quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-black/5 dark:hover:bg-white/5"
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-base font-bold text-fg">Services</h3>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
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
              {platformServices.map((svc) => (
                <tr key={svc.unit}>
                  <Td>
                    <div className="font-medium text-fg">{svc.label}</div>
                    <div className="mt-0.5 max-w-sm text-xs text-fg-muted">{svc.impact}</div>
                  </Td>
                  <Td><ServiceStatusBadge state={svc} /></Td>
                  <Td>{svc.memMb ?? svc.approxMemMb} MB</Td>
                  <Td className="text-right"><ActionButtons svc={svc} /></Td>
                </tr>
              ))}
              {platformServices.length === 0 && (
                <tr>
                  <Td className="text-fg-muted">No services tagged for this platform.</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-base font-bold text-fg">Background jobs</h3>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="min-w-full divide-y divide-border text-left text-sm">
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Runs</Th>
                <Th>Last run</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {platformJobs.map((job) => (
                <tr key={job.id}>
                  <Td>
                    <div className="font-medium text-fg">{job.label}</div>
                    <div className="mt-0.5 max-w-sm text-xs text-fg-muted">{job.description}</div>
                  </Td>
                  <Td>{job.schedule}</Td>
                  <Td>{timeAgo(job.lastRunAt)}</Td>
                  <Td><JobResultBadge result={job.lastResult} timerActive={job.timerActive} /></Td>
                </tr>
              ))}
              {platformJobs.length === 0 && (
                <tr>
                  <Td className="text-fg-muted">No background jobs tagged for this platform.</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => confirmTarget && void runAction(confirmTarget, confirmTarget.action)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmTarget ? cap(confirmTarget.action) : "Confirm"}
        confirmVariant={confirmTarget?.action === "stop" ? "danger" : "primary"}
        confirming={pending !== null}
      />
    </div>
  );
}

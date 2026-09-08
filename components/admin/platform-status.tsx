"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge, Card, Spinner } from "@/components/ui";

interface PlatformState {
  vantra: boolean;
  spaceworker: boolean;
}

type TileState = "checking" | "up" | "down";

function tileState(value: boolean | undefined): TileState {
  if (value === undefined) return "checking";
  return value ? "up" : "down";
}

const TILE_META: Record<TileState, { tone: "success" | "danger" | "neutral"; label: string }> = {
  up: { tone: "success", label: "Up" },
  down: { tone: "danger", label: "Down" },
  checking: { tone: "neutral", label: "Checking…" },
};

// Compact product-status summary for the admin landing dashboard — deliberately
// NOT a duplicate of the full Services table on /admin101/vps. Polls the admin
// status API on an interval so a tile flips to "down" within one refresh cycle.
// Tiles link into /admin101/platform/[slug] for the per-platform service +
// background-job breakdown and controls.
const REFRESH_MS = 15_000;

interface SharedServiceView {
  unit: string;
  label: string;
  platform: string;
  activeState: string;
}
interface SharedJobView {
  id: string;
  label: string;
  platform: string;
  lastRunAt: string | null;
  lastResult: string | null;
  timerActive: boolean;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never run";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PlatformStatusTiles() {
  const [status, setStatus] = useState<PlatformState | null>(null);
  const [sharedServices, setSharedServices] = useState<SharedServiceView[] | null>(null);
  const [sharedJobs, setSharedJobs] = useState<SharedJobView[] | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [statusRes, svcRes, jobRes] = await Promise.allSettled([
          fetch("/api/admin/status").then((r) => r.json()),
          fetch("/api/admin/services").then((r) => r.json()),
          fetch("/api/admin/background-jobs").then((r) => r.json()),
        ]);
        if (!active) return;
        if (statusRes.status === "fulfilled" && statusRes.value.platform) {
          setStatus(statusRes.value.platform);
        }
        if (svcRes.status === "fulfilled" && svcRes.value.services) {
          setSharedServices(svcRes.value.services.filter((s: SharedServiceView) => s.platform === "shared"));
        }
        if (jobRes.status === "fulfilled" && jobRes.value.jobs) {
          setSharedJobs(jobRes.value.jobs.filter((j: SharedJobView) => j.platform === "shared"));
        }
      } catch {
        // Leave everything in its current state; the next poll retries.
      }
    }
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const vantra = tileState(status?.vantra);
  const spaceworker = tileState(status?.spaceworker);

  return (
    <div className="space-y-6">
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <PlatformTile
          href="/admin101/platform/vantra"
          title="Vantra"
          subtitle="Device management platform"
          state={vantra}
          loading={!status}
        />
        <PlatformTile
          href="/admin101/platform/spaceworker"
          title="SpaceWorker"
          subtitle="Lead extraction & outreach"
          state={spaceworker}
          loading={!status}
        />
      </div>

      <div className="max-w-xl">
        <h2 className="text-sm font-semibold text-fg-muted">Shared / Infrastructure</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Used by both platforms — not owned by either one alone.
        </p>
        <Card className="mt-2 divide-y divide-border p-0">
          {(sharedServices ?? []).map((svc) => (
            <div key={svc.unit} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium text-fg">{svc.label}</span>
              <Badge tone={svc.activeState === "active" ? "success" : "danger"}>
                {svc.activeState === "active" ? "Running" : "Stopped"}
              </Badge>
            </div>
          ))}
          {(sharedJobs ?? []).map((job) => (
            <div key={job.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <span className="text-sm font-medium text-fg">{job.label}</span>
                <div className="text-xs text-fg-muted">{timeAgo(job.lastRunAt)}</div>
              </div>
              <Badge
                tone={
                  job.lastResult === null
                    ? "neutral"
                    : job.lastResult === "success"
                      ? "success"
                      : "danger"
                }
              >
                {job.lastResult === null ? "No runs yet" : job.lastResult === "success" ? "Success" : "Failed"}
              </Badge>
            </div>
          ))}
          {sharedServices === null && sharedJobs === null && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-fg-muted">
              <Spinner className="h-3.5 w-3.5" /> Loading…
            </div>
          )}
        </Card>
        <Link
          href="/admin101/background-jobs"
          className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          See all background jobs →
        </Link>
      </div>
    </div>
  );
}

function PlatformTile({
  href,
  title,
  subtitle,
  state,
  loading,
}: {
  href: string;
  title: string;
  subtitle: string;
  state: TileState;
  loading: boolean;
}) {
  const meta = TILE_META[state];
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:border-brand-400 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-fg">{title}</div>
            <div className="mt-0.5 text-xs text-fg-muted">{subtitle}</div>
          </div>
          <div className="flex items-center gap-2">
            {loading ? <Spinner className="h-3.5 w-3.5 text-fg-muted" /> : null}
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
        </div>
        <div className="mt-3 text-xs font-medium text-brand-600 dark:text-brand-400">
          View details →
        </div>
      </Card>
    </Link>
  );
}

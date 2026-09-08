"use client";

import { useEffect, useRef, useState } from "react";

import { Badge, Card, Td, Th } from "@/components/ui";

// Structural copy of lib/background-jobs.ts's server types — kept in sync by
// hand, same convention as ServiceStateView in admin-vps-client.tsx.
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

const REFRESH_MS = 30_000;

const PLATFORM_LABEL: Record<BackgroundJobView["platform"], string> = {
  vantra: "Vantra",
  spaceworker: "SpaceWorker",
  shared: "Shared",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "Just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function timeUntil(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  return `in ${hours}h`;
}

function ResultBadge({ result, timerActive }: { result: string | null; timerActive: boolean }) {
  if (result === null) return <Badge tone="neutral">No runs yet</Badge>;
  if (result === "success") return <Badge tone="success">Success</Badge>;
  if (!timerActive) return <Badge tone="neutral">Timer disabled</Badge>;
  return <Badge tone="danger">Failed ({result})</Badge>;
}

export function AdminBackgroundJobsClient({ initial }: { initial: BackgroundJobView[] | null }) {
  const [jobs, setJobs] = useState<BackgroundJobView[] | null>(initial);
  const [error, setError] = useState<string | null>(initial ? null : "Couldn't load background jobs.");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    async function refresh() {
      try {
        const res = await fetch("/api/admin/background-jobs");
        const data = await res.json().catch(() => ({}));
        if (!mounted.current) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load background jobs.");
          return;
        }
        setJobs(data.jobs ?? null);
        setError(null);
      } catch {
        if (mounted.current) setError("Network error while refreshing background jobs.");
      }
    }
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  const failing = (jobs ?? []).filter((j) => j.lastResult && j.lastResult !== "success" && j.timerActive);

  return (
    <div className="space-y-4">
      {error && jobs === null && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="status">
          {error}
        </div>
      )}

      {failing.length > 0 && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="status">
          {failing.map((j) => (
            <p key={j.id}>
              <strong>{j.label}</strong> last failed ({j.lastResult}) — check the service log
              (<code className="text-xs">journalctl -u {j.serviceUnit}</code>) on the box.
            </p>
          ))}
        </div>
      )}

      <Card className="p-4">
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="min-w-full divide-y divide-border text-left text-sm">
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Platform</Th>
                <Th>Runs</Th>
                <Th>Last run</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(jobs ?? []).map((job) => {
                const nextIn = timeUntil(job.nextRunAt);
                return (
                  <tr key={job.id}>
                    <Td>
                      <div className="font-medium text-fg">{job.label}</div>
                      <div className="mt-0.5 max-w-md text-xs text-fg-muted">{job.description}</div>
                    </Td>
                    <Td>
                      <Badge tone="neutral">{PLATFORM_LABEL[job.platform]}</Badge>
                    </Td>
                    <Td>
                      <div className="text-fg">{job.schedule}</div>
                      {!job.timerActive && (
                        <div className="mt-0.5 text-xs text-red-600">Timer not active</div>
                      )}
                    </Td>
                    <Td>
                      <div className="text-fg">{timeAgo(job.lastRunAt)}</div>
                      {nextIn && <div className="mt-0.5 text-xs text-fg-muted">Next {nextIn}</div>}
                    </Td>
                    <Td>
                      <ResultBadge result={job.lastResult} timerActive={job.timerActive} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

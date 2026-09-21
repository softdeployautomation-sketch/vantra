"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AddDeviceModal, type InstallerResult } from "@/components/add-device-modal";
import { PrivateMovePanel } from "@/components/private-move-panel";
import { Button, Spinner } from "@/components/ui";
import { formatRelativeTime } from "@/lib/relative-time";

interface PendingDeployment {
  // Both handles come from the server: `id` is TRMM's numeric deployment id
  // (what the DELETE endpoint wants); `uid` is the stored uid string.
  id: number;
  uid: string;
  deviceName: string | null;
  installMethod: string;
  createdAt: string;
  expiresAt: string;
  trmmSiteId: number | null;
  site_id: number;
}

const INSTALL_METHOD_LABEL: Record<string, string> = {
  merged: "Single file",
  separated: "Command",
  msi: "Signed MSI",
  zip: "ZIP",
};

function installMethodLabel(s: string): string {
  return INSTALL_METHOD_LABEL[s] ?? s;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AddDevicePageClient() {
  const [activeCount, setActiveCount] = useState(0);
  const [maxDevices, setMaxDevices] = useState(3);
  const [plan, setPlan] = useState<"free" | "premium">("free");
  const [ready, setReady] = useState(false);
  // Task 61: private-tier orgs get no installer flow (see the lockout panel
  // below). Resolved from /api/devices (same fetch that loads plan/caps).
  const [agentDomainTier, setAgentDomainTier] = useState<"public" | "private">("public");
  // Task 82: per-org public agent-host allowlist → Add Device host picker.
  const [agentApiHosts, setAgentApiHosts] = useState<string[]>([]);
  // Task 72: free-tier 24h installer-trial surfacing for the Add Device modal
  // (advisory only — POST /api/devices/deployments enforces). Resolved from
  // GET /api/exe-trial/status alongside the plan fetch above.
  const [trialExpired, setTrialExpired] = useState(false);
  const [trialHoursLeft, setTrialHoursLeft] = useState<number | null>(null);

  const [deployments, setDeployments] = useState<PendingDeployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const isPrivateOrg = agentDomainTier === "private";

  useEffect(() => {
    let active = true;

    fetch("/api/devices")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setActiveCount(d.activeDeployments ?? 0);
        setMaxDevices(d.maxDevices ?? 3);
        setPlan(d.plan === "premium" ? "premium" : "free");
        setAgentDomainTier(d.agentDomainTier === "private" ? "private" : "public");
        // Task 82: allowlist for the Add Device host picker (public orgs only).
        if (Array.isArray(d.agentApiHosts)) setAgentApiHosts(d.agentApiHosts);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });

    // Task 72: resolve the trial display state (free + expired => upgrade
    // prompt in the modal; free + active => remaining-time line). Non-blocking:
    // a failed fetch just leaves the modal ungated client-side while the API
    // still enforces. Premium/staff never gated — status returns trial "none"
    // for them, which maps to not-expired here.
    fetch("/api/exe-trial/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return;
        const isPremiumPlan = d.plan === "premium";
        const onTrial = d.trial === "trial";
        const hoursLeft = typeof d.trialHoursLeft === "number" ? d.trialHoursLeft : null;
        const started: string | null = typeof d.trialStartedAt === "string" ? d.trialStartedAt : d.trialStartedAt ?? null;
        const expired =
          !isPremiumPlan &&
          !d.eligible &&
          !d.isStaff &&
          !onTrial &&
          started !== null &&
          (hoursLeft === null || hoursLeft <= 0);
        setTrialExpired(expired);
        setTrialHoursLeft(onTrial ? hoursLeft : null);
      })
      .catch(() => {});

    fetch("/api/devices/deployments")
      .then((r) => r.json())
      .then((data) => {
        if (active) setDeployments(data.deployments ?? []);
      })
      .catch(() => {
        if (active) setDeployments([]);
      })
      .finally(() => {
        if (active) setDeploymentsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Refetches the pending list — used after generating a new installer. Only
  // ever called from event handlers (onCreated/cancel), never from an effect.
  async function refreshDeployments() {
    setDeploymentsLoading(true);
    try {
      const data = await fetch("/api/devices/deployments").then((r) => r.json());
      setDeployments(data.deployments ?? []);
    } catch {
      setDeployments([]);
    } finally {
      setDeploymentsLoading(false);
    }
  }

  function onCreated(result: InstallerResult) {
    setActiveCount(result.activeCount);
    // A freshly-generated installer is now pending — refresh the list.
    void refreshDeployments();
  }

  async function cancelDeployment(id: number) {
    setCancellingId(id);
    setCancelError(null);
    try {
      const res = await fetch(`/api/devices/deployments/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDeployments((list) => list.filter((d) => d.id !== id));
        // The cancelled installer no longer counts against the plan's device cap.
        setActiveCount((c) => Math.max(0, c - 1));
      } else {
        setCancelError(
          typeof data.error === "string" ? data.error : "Couldn't cancel that installer.",
        );
      }
    } catch {
      setCancelError("Network error while cancelling the installer.");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/dashboard" className="text-sm text-brand-600 hover:underline">
        ← Back to dashboard
      </Link>
      {/* Task 61: private-tier orgs have no self-service installer path — a
          device joins a private org only via the Task 62 PowerShell move from
          a public org. The POST endpoint 403s too; this panel is the visible
          half of the gate (never the only half). Task 70: the private branch
          is now a real generator — device picker + copyable manual move
          command (alternate delivery of Task 63's one-click move). */}
      {isPrivateOrg ? (
        <PrivateMovePanel />
      ) : (
        <div className="mt-6">
          <AddDeviceModal
            activeCount={activeCount}
            maxDevices={maxDevices}
            plan={plan}
            trialExpired={plan === "premium" ? false : trialExpired}
            trialHoursLeft={plan === "premium" ? null : trialHoursLeft}
            agentApiHosts={isPrivateOrg ? [] : agentApiHosts}
            onCreated={onCreated}
          />
        </div>
      )}
      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <strong>Good to know:</strong> each installer link expires after either 24
        or 72 hours (you choose), and your plan allows{" "}
        {maxDevices} active installation files. If you run into issues, contact
        support.
      </div>

      {/* Pending installers — list + cancel, styled to match the Devices list. */}
      <div className="mt-8">
        <h2 className="text-lg font-bold text-fg">Pending installers</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Installation files you&apos;ve generated that haven&apos;t been cancelled or
          expired yet. Cancelling one revokes its download link immediately.
        </p>

        {cancelError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {cancelError}
          </div>
        )}

        {deploymentsLoading ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-bg-elevated px-4 py-6 text-sm text-fg-muted">
            <Spinner className="h-4 w-4" /> Loading pending installers…
          </div>
        ) : deployments.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-bg-elevated px-4 py-8 text-center">
            <p className="text-sm text-fg">No pending installers yet.</p>
            <p className="mt-1 text-xs text-fg-muted">
              Use &quot;Add Device&quot; above to generate one.
            </p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-px overflow-hidden rounded-xl border border-border bg-border">
            {deployments.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 bg-bg-elevated px-4 py-3 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-semibold text-fg"
                    title={d.deviceName ?? undefined}
                  >
                    {d.deviceName || "Unnamed device"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-fg-muted">
                    {installMethodLabel(d.installMethod)} · Created{" "}
                    {formatRelativeTime(d.createdAt)} · Expires{" "}
                    {formatDateTime(d.expiresAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={cancellingId === d.id}
                  className="shrink-0 px-3 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  type="button"
                  onClick={() => void cancelDeployment(d.id)}
                >
                  {cancellingId === d.id ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    "Cancel"
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-fg-muted">
        {ready ? "Ready." : "Loading account info…"}
      </p>
    </div>
  );
}
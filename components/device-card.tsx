import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { agentStatusMeta } from "@/lib/agent-status";
import { formatRelativeTime } from "@/lib/relative-time";

export interface DeviceView {
  agent_id: string;
  hostname: string;
  status: "online" | "offline" | "overdue";
  last_seen: string;
  /** Staff/all-customers view — the customer's real org name, resolved
   *  server-side from the `vantra-{userId}` slug. The raw TRMM client_name
   *  never reaches the client. */
  orgName?: string;
  /** Friendly per-device site name (any `[vantra:...]` suffix is stripped
   *  server-side before it reaches the UI). Shown only when the customer
   *  hasn't set their own `label` below. */
  siteName?: string;
  /** Customer-editable nickname (DeviceLabel) — takes precedence over
   *  siteName/TRMM's own naming, which is often an unmemorable machine name
   *  or a leftover "Default Site". */
  label?: string | null;
  /** Per-device check counts from the TRMM agent — used by the dashboard KPI
   *  row ("devices with failing checks"). Optional: older proxies may omit it. */
  checks?: {
    total?: number;
    passing?: number;
    failing?: number;
    warning?: number;
    has_failing_checks?: boolean;
  };
}

export interface DeviceGroupChip {
  id: string;
  name: string;
}

interface DeviceCardProps {
  device: DeviceView;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  /** Groups this device belongs to (zero, one, or many). */
  groupChips?: DeviceGroupChip[];
  /** The currently-active group filter, if any — used to visually accent membership. */
  activeGroupId?: string | "all" | "ungrouped";
  /** Right-click handler for the row (opens the context menu). */
  onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
  /** Whether this viewer is allowed to rename the device — the PATCH endpoint
   *  rejects staff callers (no reliable target-org resolution for a staff
   *  bypass yet), so staff never see the rename affordance at all rather
   *  than hitting a guaranteed 403 on save. Defaults true (customer view). */
  canRename?: boolean;
}

export function DeviceCard({
  device,
  checked,
  onToggle,
  groupChips = [],
  activeGroupId,
  onContextMenu,
  canRename = true,
}: DeviceCardProps) {
  const meta = agentStatusMeta(device.status);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(device.label ?? "");
  const [currentLabel, setCurrentLabel] = useState(device.label ?? null);
  const [saving, setSaving] = useState(false);
  const [labelError, setLabelError] = useState("");
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // DeviceCard is keyed by agent_id (stable across the parent's 30s device
  // poll), so it never remounts when the label changes elsewhere (another
  // tab, another session) — without this, a freshly-fetched device.label
  // prop would silently never reach the already-mounted card's own state.
  useEffect(() => {
    if (!editing) {
      setCurrentLabel(device.label ?? null);
      setDraftLabel(device.label ?? "");
    }
  }, [device.label, editing]);

  async function saveLabel() {
    setSaving(true);
    setLabelError("");
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(device.agent_id)}/label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: draftLabel.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (res.ok) {
        setCurrentLabel(data.label ?? null);
        setEditing(false);
      } else {
        setLabelError(typeof data.error === "string" ? data.error : "Couldn't save.");
      }
    } catch {
      if (mountedRef.current) setLabelError("Network error.");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <div
      className="flex items-center gap-3 bg-bg-elevated px-4 py-3 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
      onContextMenu={onContextMenu}
    >
      <label className="flex shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border accent-brand-600"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Select ${device.hostname}`}
        />
      </label>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Device icon tile, matching the design's rounded monitor tile. */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-fg-muted dark:bg-[#1c2333] dark:text-[#8b93a7]">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
            />
          </svg>
        </div>

        <div className="min-w-0">
          {/* Link lives on the hostname only so the row's checkbox never triggers navigation. */}
          <Link
            href={`/dashboard/devices/${encodeURIComponent(device.agent_id)}`}
            className="block truncate text-sm font-semibold text-fg hover:text-brand-600 dark:hover:text-brand-400"
            title={device.hostname}
          >
            {device.hostname}
          </Link>
          {!canRename ? (
            <p className="truncate text-xs text-fg-muted">
              {currentLabel || device.siteName || "—"}
            </p>
          ) : editing ? (
            <form
              className="mt-0.5 flex items-center gap-1"
              onSubmit={(e) => { e.preventDefault(); void saveLabel(); }}
            >
              <input
                autoFocus
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                maxLength={60}
                placeholder="e.g. Mum's laptop"
                className="w-40 rounded border border-border bg-input px-1.5 py-0.5 text-xs"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="submit"
                disabled={saving}
                className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
              >
                {saving ? "…" : "Save"}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDraftLabel(currentLabel ?? ""); setEditing(false); setLabelError(""); }}
                className="text-xs text-fg-muted hover:underline"
              >
                Cancel
              </button>
              {labelError && <span className="text-xs text-red-600">{labelError}</span>}
            </form>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className="group flex min-w-0 max-w-full items-center gap-1 text-xs text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
              title="Click to rename this device"
            >
              <span className="min-w-0 truncate">{currentLabel || device.siteName || "Click to name this device"}</span>
              <svg className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {device.orgName && (
          <Badge
            tone="neutral"
            className="hidden border border-border px-2 py-0.5 md:inline-flex"
            title="Organization"
          >
            {device.orgName}
          </Badge>
        )}
        {groupChips.length > 0 && (
          <div className="hidden max-w-[14rem] flex-wrap items-center justify-end gap-1 lg:flex">
            {groupChips.map((g) => (
              <Badge
                key={g.id}
                tone="neutral"
                className={cn(
                  "border px-2 py-0.5",
                  g.id === activeGroupId
                    ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500/50 dark:bg-brand-900/40 dark:text-brand-300"
                    : "border-border",
                )}
              >
                {g.name}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-col items-end gap-0.5">
          <Badge tone={meta.tone} title={meta.description}>{meta.label}</Badge>
          <p className="whitespace-nowrap text-xs text-fg-muted">
            Last seen {formatRelativeTime(device.last_seen)}
          </p>
        </div>
      </div>
    </div>
  );
}
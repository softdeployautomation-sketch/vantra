import Link from "next/link";

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
   *  server-side before it reaches the UI). */
  siteName?: string;
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
}

export function DeviceCard({
  device,
  checked,
  onToggle,
  groupChips = [],
  activeGroupId,
  onContextMenu,
}: DeviceCardProps) {
  const meta = agentStatusMeta(device.status);
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
          {device.siteName ? (
            <p className="truncate text-xs text-fg-muted">{device.siteName}</p>
          ) : (
            <p className="text-xs text-fg-muted">—</p>
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
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <p className="whitespace-nowrap text-xs text-fg-muted">
            Last seen {formatRelativeTime(device.last_seen)}
          </p>
        </div>
      </div>
    </div>
  );
}
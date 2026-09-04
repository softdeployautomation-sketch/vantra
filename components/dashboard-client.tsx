"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { AddDeviceModal, type InstallerResult } from "@/components/add-device-modal";
import {
  DeviceContextMenu,
  type ContextMenuOpen,
} from "@/components/device-context-menu";
import {
  DeviceCard,
  type DeviceGroupChip,
  type DeviceView,
} from "@/components/device-card";
import { ConfirmDialog, Modal } from "@/components/modal";
import { Button, Input, Label, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

interface DeviceGroup {
  id: string;
  name: string;
  agentIds: string[];
}

type GroupFilter = "all" | "ungrouped" | string;

type SectionStatus = "online" | "offline";

// Colored status dot + uppercase label per section, matching the design's
// Online / Offline group headers. Colors adapt to light/dark themes.
// TRMM's "overdue" status folds into "offline" here — it's the same everyday
// "hasn't checked in" signal in practice, not a genuinely distinct state worth
// its own section (see lib/agent-status.ts).
const SECTION_STATUS_STYLES: Record<
  SectionStatus,
  { dot: string; label: string }
> = {
  online: { dot: "bg-emerald-500", label: "text-emerald-600 dark:text-emerald-300" },
  offline: { dot: "bg-red-500", label: "text-red-600 dark:text-red-300" },
};

function SectionHeader({
  title,
  count,
  status,
  expanded,
  onToggle,
}: {
  title: string;
  count: number;
  status: SectionStatus;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (count === 0) return null;
  const s = SECTION_STATUS_STYLES[status];
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 py-2 text-left transition-colors hover:text-fg"
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
      <span
        className={cn(
          "text-[0.72rem] font-bold uppercase tracking-[0.04em]",
          s.label,
        )}
      >
        {title} — {count}
      </span>
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5 text-fg-muted" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 text-fg-muted" />
      )}
    </button>
  );
}

export function DashboardClient() {
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [maxDevices, setMaxDevices] = useState(3);
  const [isStaff, setIsStaff] = useState(false);
  const [plan, setPlan] = useState<"free" | "premium">("free");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Open-ticket count for the KPI row — fetched once/regularly from /api/tickets.
  const [openTicketCount, setOpenTicketCount] = useState(0);
  // loadTickets() is called from both the mount/poll effect and a manual
  // refresh, so it can't reuse that effect's own local `active` closure —
  // this ref covers both, set false in the same effect's cleanup below.
  const mountedRef = useRef(true);

  // Device list extras: search, groups, filters, selection.
  const [search, setSearch] = useState("");
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<GroupFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlineExpanded, setOnlineExpanded] = useState(true);
  const [offlineExpanded, setOfflineExpanded] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);

  // Right-click context menu state (one shared instance for all rows).
  const [contextMenu, setContextMenu] = useState<ContextMenuOpen | null>(null);

  // Group mutation state.
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupError, setNewGroupError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DeviceGroup | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeviceGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk action state.
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);

  // NOTE: no setState is called synchronously here — only via async continuations,
  // so calling this from an effect is lint-clean.
  async function load() {
    try {
      const res = await fetch("/api/devices");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't load devices.");
        return;
      }
      setDevices(data.devices ?? []);
      setActiveCount(data.activeDeployments ?? 0);
      setMaxDevices(data.maxDevices ?? 3);
      setIsStaff(!!data.isStaff);
      setPlan(data.plan === "premium" ? "premium" : "free");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // KPI row's "open tickets" tile — counted client-side from /api/tickets (no
  // new API route). Non-blocking: a failed fetch leaves the count at its last
  // value / 0 without disturbing the device list. Called both from the
  // mount/poll effect below and from a manual refresh, so it can't reuse that
  // effect's own local `active` flag — mountedRef covers both call sites.
  async function loadTickets() {
    try {
      const res = await fetch("/api/tickets");
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current || !res.ok) return;
      const tickets = (data.tickets ?? []) as Array<{ status?: string }>;
      setOpenTicketCount(tickets.filter((t) => t.status === "open").length);
    } catch {
      // Tickets are non-critical — the dashboard still renders devices without them.
    }
  }

  async function fetchGroups() {
    try {
      const res = await fetch("/api/device-groups");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const next: DeviceGroup[] = data.groups ?? [];
        setGroups(next);
        // Default the bulk-action target to the first group when nothing matches.
        if (next.length > 0 && !next.some((g) => g.id === bulkGroupId)) {
          setBulkGroupId(next[0].id);
        }
      }
    } catch {
      // Groups are non-critical — the list still renders devices without them.
    } finally {
      setGroupsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/devices")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setDevices(data.devices ?? []);
        setActiveCount(data.activeDeployments ?? 0);
        setMaxDevices(data.maxDevices ?? 3);
        setIsStaff(!!data.isStaff);
        setPlan(data.plan === "premium" ? "premium" : "free");
      })
      .catch(() => {
        if (active) setError("Couldn't reach the device server.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          void loadTickets();
        }
      });

    fetch("/api/device-groups")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        const next: DeviceGroup[] = data.groups ?? [];
        setGroups(next);
        // Default the bulk-action target to the first group when nothing matches.
        if (next.length > 0 && !next.some((g) => g.id === bulkGroupId)) {
          setBulkGroupId(next[0].id);
        }
      })
      .catch(() => {
        // Groups are non-critical — the list still renders devices without them.
      })
      .finally(() => {
        if (active) setGroupsLoading(false);
      });

    const id = setInterval(() => {
      load();
      fetchGroups();
      void loadTickets();
    }, 30_000);
    return () => {
      active = false;
      mountedRef.current = false;
      clearInterval(id);
    };    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onRefresh() {
    setError(null);
    setLoading(true);
    load();
    fetchGroups();
    void loadTickets();
  }

  function onCreated(result: InstallerResult) {
    setActiveCount(result.activeCount);
  }

  // --- Derived device lists -------------------------------------------------

  const lowerSearch = search.trim().toLowerCase();
  const searchFiltered = useMemo(() => {
    if (!lowerSearch) return devices;
    return devices.filter((d) =>
      (d.hostname || "").toLowerCase().includes(lowerSearch) ||
      (d.orgName || "").toLowerCase().includes(lowerSearch) ||
      (d.siteName || "").toLowerCase().includes(lowerSearch),
    );
  }, [devices, lowerSearch]);

  const membershipByAgent = useMemo(() => {
    const map = new Map<string, DeviceGroupChip[]>();
    for (const g of groups) {
      for (const agentId of g.agentIds) {
        const arr = map.get(agentId) ?? [];
        arr.push({ id: g.id, name: g.name });
        map.set(agentId, arr);
      }
    }
    return map;
  }, [groups]);

  const visibleDevices = useMemo(() => {
    if (activeGroupId === "all") return searchFiltered;
    if (activeGroupId === "ungrouped")
      return searchFiltered.filter((d) => !membershipByAgent.has(d.agent_id));
    const group = groups.find((g) => g.id === activeGroupId);
    if (!group) return [];
    const idSet = new Set(group.agentIds);
    return searchFiltered.filter((d) => idSet.has(d.agent_id));
  }, [searchFiltered, activeGroupId, groups, membershipByAgent]);

  // Any status other than "online" falls into Offline — this deliberately
  // folds TRMM's "overdue" in too (see lib/agent-status.ts): it's the same
  // everyday "hasn't checked in" signal in practice, not a separate state
  // worth its own section, and this also means a device never silently
  // disappears from every section if TRMM returns an unexpected status value.
  const onlineDevices = visibleDevices.filter((d) => d.status === "online");
  const offlineDevices = visibleDevices.filter((d) => d.status !== "online");

  // Stats-band counts come from the full loaded fleet (not search/group
  // filtered), matching the design's summary card: live totals per status.
  const totalCount = devices.length;
  const onlineCount = devices.filter((d) => d.status === "online").length;
  const offlineCount = devices.filter((d) => d.status !== "online").length;
  // Full-fleet count of devices the agent reports as having at least one failing
  // check (drives the KPI row). Uses has_failing_checks when present, else falls
  // back to failing > 0 (devices silently omitted by older proxies are ignored).
  const failingChecksCount = devices.filter(
    (d) => !!(d.checks?.has_failing_checks) || (d.checks?.failing ?? 0) > 0,
  ).length;

  const activeGroup =
    activeGroupId !== "all" && activeGroupId !== "ungrouped"
      ? (groups.find((g) => g.id === activeGroupId) ?? null)
      : null;

  // --- Selection + bulk actions --------------------------------------------

  function toggleSelected(agentId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(agentId);
      else next.delete(agentId);
      return next;
    });
  }

  function handleDeviceDeleted(agentId: string) {
    // Drop the device locally. Its group-membership rows become dead pointers,
    // but the groups UI only renders devices present in the live listAgents()
    // result, so those orphaned agent_ids are inherently skipped — no cleanup
    // route or cascade needed for correctness.
    setDevices((prev) => prev.filter((d) => d.agent_id !== agentId));
    setSelected((prev) => {
      if (!prev.has(agentId)) return prev;
      const next = new Set(prev);
      next.delete(agentId);
      return next;
    });
  }

  const effectiveBulkGroupId = groups.some((g) => g.id === bulkGroupId)
    ? bulkGroupId
    : (groups[0]?.id ?? "");

  async function addSelectedToGroup() {
    if (!effectiveBulkGroupId) return;
    setBulkAdding(true);
    const agentIds = [...selected];
    try {
      const res = await fetch(`/api/device-groups/${effectiveBulkGroupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIds }),
      });
      if (res.ok) {
        await fetchGroups();
        setSelected(new Set());
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't add devices to the group.");
      }
    } catch {
      setError("Network error while adding devices to the group.");
    } finally {
      setBulkAdding(false);
    }
  }

  // --- Group CRUD -----------------------------------------------------------

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    setCreatingGroup(true);
    setNewGroupError(null);
    try {
      const res = await fetch("/api/device-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setShowNewGroup(false);
        setNewGroupName("");
        await fetchGroups();
      } else {
        const data = await res.json().catch(() => ({}));
        setNewGroupError(data.error ?? "Couldn't create the group.");
      }
    } catch {
      setNewGroupError("Network error while creating the group.");
    } finally {
      setCreatingGroup(false);
    }
  }

  function openRename(g: DeviceGroup) {
    setRenameTarget(g);
    setRenameName(g.name);
    setRenameError(null);
  }

  async function renameGroup() {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) return;
    setRenaming(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/device-groups/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setRenameTarget(null);
        await fetchGroups();
      } else {
        const data = await res.json().catch(() => ({}));
        setRenameError(data.error ?? "Couldn't rename the group.");
      }
    } catch {
      setRenameError("Network error while renaming the group.");
    } finally {
      setRenaming(false);
    }
  }

  async function deleteGroup() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/device-groups/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (activeGroupId === deleteTarget.id) setActiveGroupId("all");
        setDeleteTarget(null);
        await fetchGroups();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't delete the group.");
        setDeleteTarget(null);
      }
    } catch {
      setError("Network error while deleting the group.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  // --- Rendering -----------------------------------------------------------

  function renderRows(list: DeviceView[], dimmed = false) {
    return (
      <div
        className={cn(
          "flex flex-col gap-px overflow-hidden rounded-xl border border-border bg-border",
          dimmed && "opacity-70",
        )}
      >
        {list.map((d) => (
          <DeviceCard
            key={d.agent_id}
            device={d}
            checked={selected.has(d.agent_id)}
            onToggle={(c) => toggleSelected(d.agent_id, c)}
            groupChips={membershipByAgent.get(d.agent_id)}
            activeGroupId={activeGroupId}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({
                device: d,
                x: e.clientX,
                y: e.clientY,
              });
            }}
          />
        ))}
      </div>
    );
  }

  const hasDevices = devices.length > 0;
  const hasAnyVisible = visibleDevices.length > 0;

  return (
    <div>
      {/* Stats band — summary card with live status counts (see design canvas). */}
      <div className="rounded-2xl border border-border bg-bg-elevated/75 p-6 shadow-sm backdrop-blur-md sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-fg sm:text-2xl">Your devices</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {isStaff
                ? "All customers (staff view)."
                : `${totalCount} monitored ${totalCount === 1 ? "device" : "devices"} across your fleet.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onRefresh} disabled={loading}>
              {loading ? <Spinner /> : "Refresh"}
            </Button>
            {!isStaff && (
              <AddDeviceModal
                activeCount={activeCount}
                maxDevices={maxDevices}
                plan={plan}
                onCreated={onCreated}
              />
            )}
          </div>
        </div>
        <div className="mt-7 flex gap-8 sm:gap-14">
          <div>
            <div className="text-2xl font-bold text-fg sm:text-3xl">{onlineCount}</div>
            <div className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
              Online
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-fg sm:text-3xl">{offlineCount}</div>
            <div
              className="mt-1 text-xs font-semibold text-red-600 underline decoration-dotted decoration-red-400/60 underline-offset-2 dark:text-red-300"
              title="Hasn't checked in within its expected window — usually means the device is powered off, asleep, or has lost its network connection."
            >
              Offline
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPI row — fleet-level summary above the device list (density quick win).
          Aggregated client-side from the already-fetched device + ticket lists. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile label="Total devices" value={totalCount} />
        <KpiTile label="Online" value={onlineCount} tone="emerald" />
        <KpiTile label="Offline" value={offlineCount} tone="red" />
        <KpiTile
          // /api/tickets is user-scoped for customers but PLATFORM-WIDE for
          // staff (Ticket has no organizationId — it can't be scoped to the
          // active org the way the device tiles in this same row are).
          // Labeling this explicitly for staff avoids implying it's scoped to
          // the currently-active org like its neighbors.
          label={isStaff ? "Open tickets (all customers)" : "Open tickets"}
          value={openTicketCount}
          tone="amber"
        />
        <KpiTile
          label="Failing checks"
          value={failingChecksCount}
          tone={failingChecksCount > 0 ? "red" : "none"}
        />
      </div>

      {hasDevices && (
        <>
          <div className="relative mt-6">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
              aria-hidden="true"
            />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices…"
              aria-label="Search devices"
              style={{ paddingLeft: "2.25rem" }}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {groupsLoading ? (
              <div className="text-sm text-fg-muted">Loading groups…</div>
            ) : (
              <>
                <Pill
                  active={activeGroupId === "all"}
                  onClick={() => setActiveGroupId("all")}
                >
                  All
                </Pill>
                <Pill
                  active={activeGroupId === "ungrouped"}
                  onClick={() => setActiveGroupId("ungrouped")}
                >
                  Ungrouped
                </Pill>
                {groups.map((g) => (
                  <Pill
                    key={g.id}
                    active={activeGroupId === g.id}
                    onClick={() => setActiveGroupId(g.id)}
                  >
                    {g.name}
                  </Pill>
                ))}
                <Button
                  variant="ghost"
                  className="h-8 rounded-full px-3 text-sm"
                  onClick={() => {
                    setNewGroupName("");
                    setNewGroupError(null);
                    setShowNewGroup(true);
                  }}
                >
                  + New group
                </Button>
              </>
            )}
          </div>

          {selected.size > 0 && (
            <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2 shadow-sm">
              <span className="text-sm font-semibold text-fg">
                {selected.size} selected
              </span>
              <div className="flex items-center gap-2">
                <Select
                  className="w-44"
                  value={effectiveBulkGroupId}
                  onChange={(e) => setBulkGroupId(e.target.value)}
                  aria-label="Destination group"
                >
                  {groups.length === 0 && <option value="">No groups</option>}
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
                <Button
                  onClick={addSelectedToGroup}
                  disabled={!effectiveBulkGroupId || bulkAdding}
                >
                  {bulkAdding ? <Spinner /> : "Add to group"}
                </Button>
              </div>
              <Button
                variant="ghost"
                onClick={() => setSelected(new Set())}
                disabled={bulkAdding}
              >
                Clear selection
              </Button>
            </div>
          )}

          {activeGroup && (
            <div className="mt-4 flex items-center gap-2">
              <Button variant="secondary" onClick={() => openRename(activeGroup)}>
                Rename
              </Button>
              <Button variant="danger" onClick={() => setDeleteTarget(activeGroup)}>
                Delete
              </Button>
            </div>
          )}
        </>
      )}

      <div className="mt-6">
        {loading && devices.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-fg-muted">
            <Spinner className="mr-2" /> Loading devices…
          </div>
        ) : !hasDevices ? (
          <div className="rounded-xl border border-dashed border-border bg-bg-elevated py-16 text-center">
            <p className="text-fg">No devices yet.</p>
            <p className="mt-1 text-sm text-fg-muted">
              {isStaff
                ? "No agents registered across any customer."
                : "Use &quot;Add Device&quot; to generate a Windows installer."}
            </p>
          </div>
        ) : hasAnyVisible ? (
          <div>
            <SectionHeader
              title="Online"
              status="online"
              count={onlineDevices.length}
              expanded={onlineExpanded}
              onToggle={() => setOnlineExpanded((v) => !v)}
            />
            {onlineExpanded && renderRows(onlineDevices)}

            <SectionHeader
              title="Offline"
              status="offline"
              count={offlineDevices.length}
              expanded={offlineExpanded}
              onToggle={() => setOfflineExpanded((v) => !v)}
            />
            {/* Offline rows are dimmed, matching the design's treatment. */}
            {offlineExpanded && renderRows(offlineDevices, true)}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-bg-elevated py-16 text-center">
            <p className="text-fg">No devices match this filter.</p>
            <p className="mt-1 text-sm text-fg-muted">
              Try a different search or group.
            </p>
          </div>
        )}
      </div>

      <Modal open={showNewGroup} onClose={() => setShowNewGroup(false)} title="New group">
        <Label htmlFor="new-group-name">Group name</Label>
        <Input
          id="new-group-name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="e.g. Workstations"
          autoFocus
        />
        {newGroupError && (
          <div className="mt-2 text-sm text-red-600">{newGroupError}</div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={() => setShowNewGroup(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={createGroup}
            disabled={creatingGroup || !newGroupName.trim()}
          >
            {creatingGroup ? <Spinner /> : "Create group"}
          </Button>
        </div>
      </Modal>

      <Modal open={!!renameTarget} onClose={() => setRenameTarget(null)} title="Rename group">
        <Label htmlFor="rename-group-name">Group name</Label>
        <Input
          id="rename-group-name"
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          autoFocus
        />
        {renameError && (
          <div className="mt-2 text-sm text-red-600">{renameError}</div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            type="button"
            onClick={() => setRenameTarget(null)}
            disabled={renaming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={renameGroup}
            disabled={renaming || !renameName.trim()}
          >
            {renaming ? <Spinner /> : "Save"}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteGroup}
        title="Delete group"
        description={`Delete "${deleteTarget?.name}"? Its devices will keep their other group memberships.`}
        confirmLabel="Delete group"
        confirmVariant="danger"
        confirming={deleting}
      />

      <DeviceContextMenu
        key={contextMenu?.device.agent_id ?? "closed"}
        openState={contextMenu}
        onClose={() => setContextMenu(null)}
        onDeviceDeleted={handleDeviceDeleted}
      />
    </div>
  );
}

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Pill({ active, onClick, children }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors",
        active
          ? "bg-brand-600 text-white"
          : "border border-border bg-bg-elevated text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

interface KpiTileProps {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "red" | "none";
}

// One tile in the dashboard KPI row. Matches the design's borderless, tinted
// stat-card language (same style as the device Overview's check tiles).
function KpiTile({ label, value, tone = "none" }: KpiTileProps) {
  const bg = {
    emerald: "bg-emerald-500/10",
    amber: "bg-amber-500/10",
    red: "bg-red-500/10",
    none: "bg-bg-elevated",
  }[tone];
  const color = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    none: "text-fg",
  }[tone];
  return (
    <div className={`rounded-xl ${bg} p-4 text-center`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className={tone !== "none" ? `mt-1 text-xs font-semibold ${color}` : "mt-1 text-xs text-fg-muted"}>
        {label}
      </div>
    </div>
  );
}
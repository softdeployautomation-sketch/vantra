"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

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

function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1 py-2 text-left text-sm font-semibold text-fg-muted transition-colors hover:text-fg"
    >
      {expanded ? (
        <ChevronDown className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
      {title} ({count})
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
        if (active) setLoading(false);
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
    }, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onRefresh() {
    setError(null);
    setLoading(true);
    load();
    fetchGroups();
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

  // overdue counts as offline for this split (matches offline tone fallback).
  const onlineDevices = visibleDevices.filter((d) => d.status === "online");
  const offlineDevices = visibleDevices.filter((d) => d.status !== "online");

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

  function renderRows(list: DeviceView[]) {
    return (
      <div className="space-y-2">
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Your devices</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {isStaff
              ? "All customers (staff view)."
              : "Live status from your fleet."}
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

      {error && (
        <div className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {hasDevices && (
        <>
          <div className="mt-6">
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by hostname, client, or site…"
              aria-label="Search devices"
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
              count={onlineDevices.length}
              expanded={onlineExpanded}
              onToggle={() => setOnlineExpanded((v) => !v)}
            />
            {onlineExpanded && renderRows(onlineDevices)}

            <SectionHeader
              title="Offline"
              count={offlineDevices.length}
              expanded={offlineExpanded}
              onToggle={() => setOfflineExpanded((v) => !v)}
            />
            {offlineExpanded && renderRows(offlineDevices)}
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
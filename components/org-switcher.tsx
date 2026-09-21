"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Check, Pencil, Plus } from "lucide-react";
import { Button, Input, Spinner } from "@/components/ui";
import { TierBadge } from "@/components/tier-badge";
import { useToast } from "@/components/toast";

interface OrgOption { id: string; name: string; agentDomainTier?: string | null; }

/** Task 70: display fallback for a freshly-granted (still unnamed) org. */
export function orgDisplayName(org: { name: string }): string {
  return org.name?.trim() ? org.name : "Unnamed organization";
}

export function OrgSwitcher({
  activeOrg,
  organizations,
}: {
  activeOrg: OrgOption;
  organizations: OrgOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  // Task 70: inline rename of an unnamed org (freshly-granted private org).
  // Keyed by org id; only one rename form is open at a time.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  async function switchTo(id: string) {
    if (id === activeOrg.id) { setOpen(false); return; }
    setSwitchingId(id);
    try {
      const res = await fetch("/api/organizations/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.push(data.error ?? "Couldn't switch organization.", "error"); return; }
      setOpen(false);
      // A plain router.refresh() only re-renders SERVER components with fresh
      // props — the device list (DashboardClient) is a client component that
      // fetches its own data once on mount, so it never noticed the org
      // change and kept showing the previous org's devices until a manual
      // reload. A hard reload guarantees every client component remounts
      // fresh against the newly-active org. Switching INTO an unnamed org
      // lands on the dashboard layout gate, which redirects to /onboarding
      // to name it (Task 70: same first-run UX, re-triggered by org-switch).
      window.location.reload();
    } catch {
      toast.push("Network error while switching.", "error");
    } finally {
      setSwitchingId(null);
    }
  }

  async function createOrg() {
    setNewError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNewError(data.error ?? "Couldn't create the organization."); return; }
      setNewName("");
      setOpen(false);
      toast.push(`Created "${data.name}".`);
      router.refresh();
    } catch {
      setNewError("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function renameOrg(id: string) {
    setRenameError(null);
    setRenaming(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName: renameValue.trim(), orgId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setRenameError(data.error ?? "Couldn't name it."); return; }
      setRenamingId(null);
      setRenameValue("");
      setOpen(false);
      toast.push(`Named "${data.orgName}".`, "success");
      router.refresh();
    } catch {
      setRenameError("Network error. Please try again.");
    } finally {
      setRenaming(false);
    }
  }

  function startRename(id: string) {
    setRenameError(null);
    setRenameValue("");
    setRenamingId(id);
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-bg-elevated/90 px-3 py-2.5">
      <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-fg-muted">Organization</div>
      <div className="relative mt-1">
        <button type="button" onClick={() => { setNewError(null); setNewName(""); setOpen((o) => !o); }}
          className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-sm font-medium text-fg hover:bg-black/5 dark:hover:bg-white/5">
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-fg-muted" />
            <span className="truncate">{orgDisplayName(activeOrg)}</span>
            <TierBadge tier={activeOrg.agentDomainTier} />
          </span>
          <svg className={`h-4 w-4 shrink-0 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-xl">
            <ul className="max-h-56 overflow-y-auto py-1">
              {organizations.map((org) => {
                const active = org.id === activeOrg.id;
                const unnamed = !org.name?.trim();
                if (renamingId === org.id) {
                  return (
                    <li key={org.id} className="px-3 py-2">
                      <p className="text-xs font-medium text-fg">Name this organization</p>
                      <div className="mt-1.5">
                        <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                          placeholder="Organization name" maxLength={80} disabled={renaming} />
                      </div>
                      {renameError && <p className="mt-1 text-xs text-red-600">{renameError}</p>}
                      <div className="mt-1.5 flex justify-end gap-2">
                        <Button variant="secondary" type="button"
                          onClick={() => { setRenamingId(null); setRenameError(null); }}
                          disabled={renaming} className="px-2 py-1 text-xs">
                          Cancel
                        </Button>
                        <Button type="button" onClick={() => void renameOrg(org.id)}
                          disabled={renaming || renameValue.trim().length < 2}
                          className="px-2 py-1 text-xs">
                          {renaming && <Spinner className="h-3 w-3" />} Save
                        </Button>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={org.id} className="flex items-center gap-1 px-1 py-0.5">
                    <button type="button" onClick={() => switchTo(org.id)}
                      disabled={switchingId !== null || active}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm text-fg hover:bg-black/5 disabled:opacity-70 dark:hover:bg-white/5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{orgDisplayName(org)}</span>
                        <TierBadge tier={org.agentDomainTier} />
                      </span>
                      {active ? (
                        <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                      ) : switchingId === org.id ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : null}
                    </button>
                    {!active && switchingId !== org.id && unnamed && (
                      <button
                        type="button"
                        title="Name this organization"
                        aria-label="Name this organization"
                        onClick={() => startRename(org.id)}
                        className="shrink-0 rounded p-1.5 text-brand-600 hover:bg-black/5 dark:text-brand-400 dark:hover:bg-white/5"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border p-2">
              {/* Task 75: self-service is capped at ONE org per user — hide the
                  "+ New organization" creator once the caller already owns an
                  org (organizations prop is their full owned list, no fetch
                  needed). The API still enforces the cap server-side; this is
                  UX only. Additional orgs of either tier are admin-granted. */}
              {organizations.length >= 1 ? (
                <p className="px-3 py-2 text-xs text-fg-muted">
                  Additional organizations are granted by an admin.
                </p>
              ) : creating ? (
                <div className="space-y-2">
                  <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                    placeholder="Organization name" maxLength={80} />
                  {newError && <p className="text-xs text-red-600">{newError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" type="button" onClick={() => { setCreating(false); setNewError(null); }}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={createOrg} disabled={newName.trim().length < 2}>
                      Create
                    </Button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => { setNewError(null); setCreating(true); }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-brand-600 hover:bg-black/5 dark:text-brand-400 dark:hover:bg-white/5">
                  <Plus className="h-4 w-4" />
                  New organization
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
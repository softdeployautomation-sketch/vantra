"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Check, Plus } from "lucide-react";
import { Button, Input, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";

interface OrgOption { id: string; name: string; }

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
      router.refresh(); // every server component re-reads the newly-active org
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

  return (
    <div className="mb-4 rounded-lg border border-border bg-bg-elevated/90 px-3 py-2.5">
      <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-fg-muted">Organization</div>
      <div className="relative mt-1">
        <button type="button" onClick={() => { setNewError(null); setNewName(""); setOpen((o) => !o); }}
          className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-sm font-medium text-fg hover:bg-black/5 dark:hover:bg-white/5">
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-fg-muted" />
            <span className="truncate">{activeOrg.name}</span>
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
                return (
                  <li key={org.id}>
                    <button type="button" onClick={() => switchTo(org.id)}
                      disabled={switchingId !== null || active}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-black/5 disabled:opacity-70 dark:hover:bg-white/5">
                      <span className="truncate">{org.name}</span>
                      {active ? (
                        <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                      ) : switchingId === org.id ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border p-2">
              {creating ? (
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
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Input, Spinner } from "@/components/ui";

interface OrgDeleteInfo {
  id: string;
  name: string;
  tier: string;
  plan: string;
  deviceCount: number;
}

// Task 73 — "Delete organization" admin action. Fetches live org info
// (name/tier/plan + TRMM device count) when the dialog opens. Empty orgs get
// a standard confirm; orgs WITH devices require typing the exact org name
// (or DELETE for unnamed orgs). TRMM itself is never touched.
export function DeleteOrgButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [info, setInfo] = useState<OrgDeleteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  async function openDialog() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setInfo(null);
    setTyped("");
    try {
      const res = await fetch(
        `/api/admin/organizations/${encodeURIComponent(orgId)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't load organization.");
        return;
      }
      setInfo(data as OrgDeleteInfo);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const hasDevices = (info?.deviceCount ?? 0) > 0;
  const expected = info && info.name.trim().length > 0 ? info.name : "DELETE";
  const typedOk = !hasDevices || typed === expected;

  async function destroy() {
    if (!info || working || !typedOk) return;
    setWorking(true);
    try {
      const res = await fetch(
        `/api/admin/organizations/${encodeURIComponent(orgId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            hasDevices
              ? { confirmName: typed, deviceCountSeen: info.deviceCount }
              : {},
          ),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't delete the organization.", "error");
        return;
      }
      toast.push(
        hasDevices
          ? `Org deleted — ${data.deletedDevices ?? info.deviceCount} device record(s) removed. TRMM untouched.`
          : "Organization deleted.",
        "success",
      );
      setOpen(false);
      router.refresh();
    } catch {
      toast.push("Network error. Please try again.", "error");
    } finally {
      setWorking(false);
    }
  }

  const blocked = !info || info.deviceCount === -1;
  const countLabel =
    !info || info.deviceCount === -1
      ? "device count unavailable (TRMM unreachable — deletion blocked)"
      : `${info.deviceCount} device${info.deviceCount === 1 ? "" : "s"} (live)`;

  return (
    <>
      <Button
        variant="secondary"
        type="button"
        className="px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
        onClick={openDialog}
      >
        Delete org
      </Button>
      <Modal
        open={open}
        onClose={() => !working && !loading && setOpen(false)}
        title="Delete organization?"
      >
        {loading && (
          <p className="text-sm text-fg-muted">Loading live device count…</p>
        )}
        {error && !loading && <p className="text-sm text-red-600">{error}</p>}
        {info && !loading && !error && (
          <div className="space-y-3 text-sm">
            <p className="text-fg-muted">
              <span className="font-semibold text-fg">
                {info.name || "— (unnamed)"}
              </span>{" "}
              · tier {info.tier} · plan {info.plan} · {countLabel}
            </p>
            {info.deviceCount === -1 ? (
              <p className="text-sm text-amber-700">
                Deletion is blocked while TRMM is unreachable.
              </p>
            ) : !hasDevices ? (
              <p className="text-fg-muted">
                This organization has no devices. This can&apos;t be undone.
              </p>
            ) : (
              <>
                <p className="font-medium text-red-700 dark:text-red-400">
                  This org has {info.deviceCount} device
                  {info.deviceCount === 1 ? "" : "s"}. Deleting removes the
                  Vantra-side records — not the devices, not TRMM enrollment.
                </p>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-fg">
                    Type <code className="font-bold">{expected}</code> to confirm
                  </span>
                  <Input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={expected}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setOpen(false)}
                disabled={working}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                type="button"
                onClick={destroy}
                disabled={working || blocked || !typedOk}
              >
                {working && <Spinner />} Delete organization
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}


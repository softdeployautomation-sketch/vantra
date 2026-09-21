"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Spinner } from "@/components/ui";

/**
 * Task 70 (supersedes Task 60's named grant) + Task 75 (tier choice):
 * admin "Grant organization" action. ALWAYS creates the org unnamed — the
 * owner names it themselves from the dashboard (org switcher inline rename /
 * onboarding re-gate), and gets emailed about the grant. No name input (the
 * old one was removed deliberately — the admin no longer names the org).
 *
 * Task 75: a tier picker (public/private, default private for backward
 * compat) selects which tier to grant. Both tiers share the single
 * `/api/admin/users/[userId]/grant-private-organization` route (now
 * tier-parameterized, no sibling route) and Task 70's unnamed +
 * owner-naming + email-notification behavior.
 */
export function GrantPrivateOrgButton({ userId }: { userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<"public" | "private">("private");
  const [working, setWorking] = useState(false);

  async function grant() {
    setWorking(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/grant-private-organization`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't grant an organization.", "error");
        return;
      }
      toast.push(
        `${tier === "private" ? "Private" : "Public"} organization created (unnamed) — the owner names it from their dashboard and was emailed.`,
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

  return (
    <>
      <Button
        variant="secondary"
        type="button"
        className="px-2.5 py-1.5 text-xs"
        onClick={() => setOpen(true)}
      >
        Grant organization
      </Button>
      <Modal
        open={open}
        onClose={() => !working && setOpen(false)}
        title="Grant organization?"
      >
        <p className="text-sm text-fg-muted">
          Creates a NEW unnamed organization for this user. Their existing
          orgs and devices are completely untouched — this is an additional
          org, not an upgrade. The owner names it themselves from their
          dashboard and is emailed about the grant.
        </p>
        <div className="mt-4 flex items-center gap-4 text-sm">
          <span className="font-medium text-fg">Tier:</span>
          {(["private", "public"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-fg">
              <input
                type="radio"
                name="grant-org-tier"
                value={t}
                checked={tier === t}
                disabled={working}
                onChange={() => setTier(t)}
              />
              {t === "private" ? "Private" : "Public"}
            </label>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            type="button"
            onClick={() => !working && setOpen(false)}
            disabled={working}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={grant}
            disabled={working}
          >
            {working && <Spinner />} Grant {tier} org
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Task 75 alias: same tier-choice grant action under the generalized name. */
export const GrantOrgButton = GrantPrivateOrgButton;

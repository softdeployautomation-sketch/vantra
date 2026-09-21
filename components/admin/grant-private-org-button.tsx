"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Spinner } from "@/components/ui";

/**
 * Task 70 (supersedes Task 60's named grant): admin "Grant private
 * organization" action. ALWAYS creates the org unnamed — the owner names it
 * themselves from the dashboard (org switcher inline rename / onboarding
 * re-gate), and gets emailed about the grant. No name input (the old one was
 * removed deliberately — the admin no longer names the org).
 */
export function GrantPrivateOrgButton({ userId }: { userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  async function grant() {
    setWorking(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/grant-private-organization`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't grant a private organization.", "error");
        return;
      }
      toast.push(
        "Private organization created (unnamed) — the owner names it from their dashboard and was emailed.",
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
        Grant private organization
      </Button>
      <Modal
        open={open}
        onClose={() => !working && setOpen(false)}
        title="Grant private organization?"
      >
        <p className="text-sm text-fg-muted">
          Creates a NEW unnamed private-tier organization for this user. Their
          existing public org and devices are completely untouched — this is an
          additional org, not an upgrade. The owner names it themselves from
          their dashboard and is emailed about the grant.
        </p>
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
            {working && <Spinner />} Grant private org
          </Button>
        </div>
      </Modal>
    </>
  );
}

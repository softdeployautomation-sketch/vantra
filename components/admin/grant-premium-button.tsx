"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";

/**
 * Shared "Grant Premium" action for a single organization, reused on both the
 * admin Users list and the per-user detail page so the behavior never drifts.
 * Only shown when the org is currently free — renewal isn't an admin action per
 * the existing wallet-based renewal flow, so an already-premium org gets no
 * button. Behind a ConfirmDialog (same pattern as the rest of the admin panel)
 * and refreshes after success.
 */
export function GrantPremiumButton({
  orgId,
  plan,
}: {
  orgId: string;
  plan: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  if (plan === "premium") return null;

  async function grant() {
    setWorking(true);
    try {
      const res = await fetch(
        `/api/admin/organizations/${encodeURIComponent(orgId)}/grant-premium`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't grant premium.", "error");
        return;
      }
      toast.push("Premium granted — expires in 30 days.", "success");
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
        Grant Premium
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => !working && setOpen(false)}
        onConfirm={grant}
        title="Grant Premium?"
        description="Extends this organization's premium by 30 days from now (stacking with any active time). This matches what the customer's own Activate/Renew flow does."
        confirmLabel="Grant Premium"
        confirmVariant="primary"
        confirming={working}
      />
    </>
  );
}
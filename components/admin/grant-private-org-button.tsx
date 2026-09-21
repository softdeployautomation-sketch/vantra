"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Input, Label, Spinner } from "@/components/ui";

/**
 * Task 60 (Task 53 Part 2): admin "Grant private organization" action for a
 * chosen user. Creates a NEW private-tier Organization (never an upgrade —
 * the user's existing public org/devices are untouched). Modal with a name
 * input (same Button/Input/Modal primitives as the rest of the admin panel),
 * refreshes after success.
 */
export function GrantPrivateOrgButton({ userId }: { userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Private");
  const [working, setWorking] = useState(false);

  async function grant() {
    setWorking(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/grant-private-organization`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() || "Private" }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't grant a private organization.", "error");
        return;
      }
      toast.push(
        `Private organization "${data.name ?? "Private"}" created.`,
        "success",
      );
      setOpen(false);
      setName("Private");
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
        onClick={() => {
          setName("Private");
          setOpen(true);
        }}
      >
        Grant private organization
      </Button>
      <Modal
        open={open}
        onClose={() => !working && setOpen(false)}
        title="Grant private organization?"
      >
        <p className="text-sm text-fg-muted">
          Creates a NEW private-tier organization for this user. Their existing
          public org and devices are completely untouched — this is an
          additional org, not an upgrade.
        </p>
        <div className="mt-4">
          <Label htmlFor="grant-private-org-name">Private org name</Label>
          <Input
            id="grant-private-org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Private"
            maxLength={80}
            disabled={working}
          />
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
            disabled={working || name.trim().length < 2}
          >
            {working && <Spinner />} Grant private org
          </Button>
        </div>
      </Modal>
    </>
  );
}

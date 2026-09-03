"use client";

import { useEffect, useState } from "react";

import type { DeviceView } from "@/components/device-card";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Input, Label, Spinner } from "@/components/ui";

export interface ContextMenuOpen {
  device: DeviceView;
  x: number;
  y: number;
}

const MENU_WIDTH = 232;
const MENU_HEIGHT = 252;
const EDGE_MARGIN = 8;

interface DeviceContextMenuProps {
  openState: ContextMenuOpen | null;
  onClose: () => void;
  /** Called after a successful delete so the parent can drop the device locally. */
  onDeviceDeleted: (agentId: string) => void;
}

export function DeviceContextMenu({
  openState,
  onClose,
  onDeviceDeleted,
}: DeviceContextMenuProps) {
  const toast = useToast();
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Close on Escape.
  useEffect(() => {
    if (!openState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openState, onClose]);

  if (!openState) return null;

  const device = openState.device;

  // Clamp so the menu never runs off the viewport edge.
  const left = Math.max(
    EDGE_MARGIN,
    Math.min(openState.x, window.innerWidth - MENU_WIDTH - EDGE_MARGIN),
  );
  const top = Math.max(
    EDGE_MARGIN,
    Math.min(openState.y, window.innerHeight - MENU_HEIGHT - EDGE_MARGIN),
  );

  async function fetchMeshUrl(tab: "control" | "terminal"): Promise<string | null> {
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(device.agent_id)}/mesh`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't load remote access.", "error");
        return null;
      }
      const url = (data.urls ?? {})[tab];
      if (!url) {
        toast.push("Remote access is unavailable for this device.", "error");
        return null;
      }
      return url as string;
    } catch {
      toast.push("Network error while loading remote access.", "error");
      return null;
    }
  }

  async function openRemote(tab: "control" | "terminal", withOverlay: boolean) {
    setActionLoading(true);
    try {
      if (withOverlay) {
        try {
          const res = await fetch(
            `/api/devices/${encodeURIComponent(device.agent_id)}/maintenance-overlay`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "start" }),
            },
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.push(
              data.error ?? "Couldn't start the maintenance screen.",
              "error",
            );
            return;
          }
          toast.push(
            "Maintenance screen started — it covers the real screen visually (not true input-blocking). Remember to stop it when you're done.",
            "success",
          );
        } catch {
          toast.push("Network error while starting the maintenance screen.", "error");
          return;
        }
      }

      const url = await fetchMeshUrl(tab);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        onClose();
      }
    } finally {
      setActionLoading(false);
    }
  }

  function openDelete() {
    setTyped("");
    setConfirmOpen(true);
  }

  async function confirmDelete() {
    if (typed.trim() !== device.hostname || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(device.agent_id)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't delete this device.", "error");
        setDeleting(false);
        return;
      }
      toast.push("Device deleted.", "success");
      setConfirmOpen(false);
      onDeviceDeleted(device.agent_id);
      onClose();
    } catch {
      toast.push("Network error while deleting the device.", "error");
      setDeleting(false);
    }
  }

  const canConfirm = typed.trim() === device.hostname;

  return (
    <>
      {/* Transparent full-screen layer that catches outside clicks / right-clicks. */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />

      <div
        role="menu"
        className="fixed z-50 w-56 rounded-xl border border-border bg-bg-elevated p-1 shadow-xl"
        style={{ left, top }}
      >
        <MenuButton
          disabled={actionLoading}
          onClick={() => openRemote("control", false)}
        >
          Control
        </MenuButton>
        <MenuButton
          disabled={actionLoading}
          onClick={() => openRemote("terminal", false)}
        >
          Terminal
        </MenuButton>
        <MenuButton
          disabled={actionLoading}
          onClick={() => openRemote("control", true)}
        >
          Control (with maintenance screen)
        </MenuButton>

        <div className="my-1 h-px bg-border" role="separator" />

        <MenuButton danger disabled={actionLoading} onClick={openDelete}>
          Delete device
        </MenuButton>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !deleting && setConfirmOpen(false)}
        title="Delete device"
      >
        <p className="text-sm text-fg-muted">
          This is permanent and irreversible. It tells{" "}
          <span className="font-semibold text-fg">{device.hostname}</span> to
          uninstall its agent <em>and</em> removes it from Vantra &amp; TRMM — even
          if the device is currently offline.
        </p>
        <p className="mt-3 text-sm text-fg-muted">
          Type the device&apos;s hostname to confirm:
        </p>
        <div className="mt-1">
          <Label htmlFor="delete-device-confirm">Hostname</Label>
          <Input
            id="delete-device-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={device.hostname}
            autoFocus
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            type="button"
            onClick={() => setConfirmOpen(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            type="button"
            onClick={confirmDelete}
            disabled={!canConfirm || deleting}
          >
            {deleting ? <Spinner /> : "Delete device"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function MenuButton({
  danger,
  disabled,
  onClick,
  children,
}: {
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={
        `flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ` +
        (danger
          ? "font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 "
          : "text-fg hover:bg-black/5 dark:hover:bg-white/5 ") +
        (disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")
      }
    >
      {children}
    </button>
  );
}
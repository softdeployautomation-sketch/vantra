"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card, Spinner } from "@/components/ui";

// Desktop mode — replaces a gated route's real content (2026-09-19, revised
// after live testing showed the earlier redirect-to-Settings approach left
// the switch-back control easy to miss). Never shows any device data;
// Settings/Support stay reachable via the sidebar exactly as normal — this
// only ever appears in place of everything else.
export function DesktopLockScreen({ boundMachineLabel }: { boundMachineLabel: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function switchToWeb() {
    if (
      !window.confirm(
        `Switch back to web? This revokes your Vantra Desktop license on ${
          boundMachineLabel || "the bound device"
        } immediately — that app will be signed out on its next check and you'd need to open it again to reactivate.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/exe-license/switch-to-web", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't switch back to web.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mb-3 flex items-center justify-center gap-2">
          <span className="text-lg font-bold text-fg">Locked to desktop</span>
          <Badge tone="neutral">Desktop mode</Badge>
        </div>
        <p className="text-sm text-fg-muted">
          Your account is active on <strong>{boundMachineLabel || "your bound device"}</strong> —
          this is where your devices, tickets and everything else lives now. You can still manage
          billing and support from any browser using the sidebar.
        </p>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        ) : null}
        <Button variant="secondary" className="mt-4" onClick={() => void switchToWeb()} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : null} Switch back to web
        </Button>
      </Card>
    </div>
  );
}

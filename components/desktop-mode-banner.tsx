"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card, Spinner } from "@/components/ui";

// Desktop mode (2026-09-18/19 spec) — shown on Settings (the one page that
// stays reachable) whenever this account's Vantra Desktop license is bound
// somewhere and the CURRENT session isn't that device — see
// lib/desktop-mode.ts and app/dashboard/layout.tsx's redirect. "Switch back
// to web" unbinds the desktop device, restoring full web access on any
// browser from the next request. There is no local database to migrate —
// this only ever changes which device the license is bound to.
export function DesktopModeBanner({ boundMachineLabel }: { boundMachineLabel: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function switchToWeb() {
    if (
      !window.confirm(
        `Switch back to web? This deactivates your Vantra Desktop license on ${
          boundMachineLabel || "the bound device"
        } immediately — you'd need to open the desktop app again to reactivate it there.`,
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
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-fg">You&apos;re using Vantra Desktop</span>
        <Badge tone="neutral">Desktop mode</Badge>
      </div>
      <p className="mt-2 text-sm text-fg-muted">
        Your full dashboard lives in the desktop app on {boundMachineLabel || "your bound device"}
        . From here on the web you can still manage billing and your license — everything else
        is in the app.
      </p>
      {error ? (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <Button variant="secondary" className="mt-3" onClick={() => void switchToWeb()} disabled={busy}>
        {busy ? <Spinner className="h-4 w-4" /> : null} Switch back to web
      </Button>
    </Card>
  );
}

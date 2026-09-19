"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Self-service redesign (2026-09-19) — exe-gate.tsx puts this device's
// auto-detected Device ID on the top-level /workspace URL, but the Dashboard
// tab is a same-origin IFRAME (src="/dashboard", no query passthrough — see
// workspace-shell.tsx's DASHBOARD_TAB), and any further in-iframe navigation
// (e.g. clicking Settings) is a fresh client-side route with no query string
// at all. A URL param alone never survives that trip.
//
// sessionStorage does: same-origin frames within one tab all share it, so
// stashing the handoff here on the very first /workspace load lets
// exe-license-self-service.tsx read it back however many hops later the user
// actually reaches Settings. Renders nothing — this is pure plumbing,
// mounted once alongside WorkspaceShell.
export const EXE_HANDOFF_KEY = "vantra:exe-handoff";

export interface ExeHandoff {
  deviceId: string;
  deviceLabel: string;
  returnOrigin: string;
  // Whether THIS device is already licensed, as of the moment exe-gate.tsx
  // last checked (its own /api/exe-license/status call) — so Settings can
  // show "licensed until X" instead of defaulting to the registration form
  // on every revisit, even right after a successful activation.
  licensed: boolean;
  expiresAt?: string;
}

export function WorkspaceHandoff() {
  const params = useSearchParams();

  useEffect(() => {
    const deviceId = params.get("deviceId");
    if (!deviceId) return;
    try {
      const payload: ExeHandoff = {
        deviceId,
        deviceLabel: params.get("deviceLabel") ?? "",
        returnOrigin: params.get("returnOrigin") ?? "",
        licensed: params.get("licensed") === "1",
        expiresAt: params.get("expiresAt") ?? undefined,
      };
      sessionStorage.setItem(EXE_HANDOFF_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage unavailable (private mode, etc.) — Settings just has
      // no handoff context on this visit; harmless.
    }
    // Persist the device id server-side too (a long-lived cookie, not
    // sessionStorage) so getCurrentUser() can keep re-checking this specific
    // device's binding for the life of the login, not just this one visit —
    // see lib/auth.ts's EXE_DEVICE_COOKIE comment. Only once exe-gate.tsx has
    // confirmed this device IS actually licensed — setting it on an
    // unlicensed first visit would make getCurrentUser() sign the user out
    // before they ever get a chance to click "Register this device".
    if (params.get("licensed") === "1") {
      void fetch("/api/exe-license/remember-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      }).catch(() => {
        // Best-effort — worst case this session doesn't get the auto-sign-out
        // behavior until the next handoff visit sets it successfully.
      });
    }
  }, [params]);

  return null;
}

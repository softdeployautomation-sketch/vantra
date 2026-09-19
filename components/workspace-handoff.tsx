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
      };
      sessionStorage.setItem(EXE_HANDOFF_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage unavailable (private mode, etc.) — the self-service
      // card just falls back to the manual paste flow.
    }
  }, [params]);

  return null;
}

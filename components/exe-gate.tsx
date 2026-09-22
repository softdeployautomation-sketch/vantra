"use client";

import { useEffect, useState } from "react";

import { Card, Spinner } from "@/components/ui";
import { ExeFirstLaunch } from "@/components/exe-first-launch";

// Task 44.3 — the thin Vantra EXE license gate. This is the ONLY screen the
// desktop window shows before the hosted app. Runs against the bundled local
// runtime (POST /api/exe-license/status), which:
//
//   - silently starts a 24h trial on first launch,
//   - reports `licensed` / `inTrial` / expired, and the auto-detected
//     machineId (no user input — see lib/machine-id.ts),
//   - and is the only thing the desktop-exe runtime ships locally (no
//     DATABASE_URL, no VPS secrets — see scripts/runtime-assemble.mjs).
//
// Self-service redesign (2026-09-19) — this used to hard-block an unlicensed/
// expired device on a local dead-end form, with no way to reach Wallet,
// Settings, or Support to actually fix that. It no longer does: the desktop
// EXE's per-machine license only ever gated whether this WRAPPER proceeds
// past its splash screen — real feature access is the user's own web tier/
// staff status, enforced server-side exactly like a browser session, so
// there's nothing to protect by blocking navigation here. Every outcome now
// continues straight to the hosted app, carrying the auto-detected Device ID
// along in the URL so Settings' self-service card (ExeLicenseSelfService) can
// register this machine with a single click — no manual copy-paste of a
// Device ID, matching how the standalone lead-extractor's own license check
// always worked. See app/activate-complete/page.tsx for the return hop that
// finishes LOCAL activation once the hosted side mints a bound key.
const HOSTED_APP_URL = "https://vantra.spaceworker.top";

type Phase = "loading" | "unavailable" | "continuing" | "first-launch";

export function ExeGate() {
  const [phase, setPhase] = useState<Phase>("loading");

  function openHostedApp(machineId: string, licensed: boolean, expiresAtDate?: string) {
    const params = new URLSearchParams({ source: "exe" });
    if (machineId) {
      params.set("deviceId", machineId);
      params.set(
        "deviceLabel",
        typeof navigator !== "undefined" && navigator.platform ? navigator.platform : "This device",
      );
      params.set("returnOrigin", window.location.origin);
      // Settings' self-service card has no other way to know THIS device is
      // already licensed — without this it always shows the registration
      // form again on a revisit, even for an activated device (confirmed
      // live, 2026-09-19).
      params.set("licensed", licensed ? "1" : "0");
      if (licensed && expiresAtDate) params.set("expiresAt", expiresAtDate);
    }
    window.location.replace(`${HOSTED_APP_URL}/workspace?${params.toString()}`);
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/exe-license/status", { method: "POST" });
        if (res.status === 404) {
          // Route absent => not running inside the EXE's local runtime.
          setPhase("unavailable");
          return;
        }
        const data = await res.json().catch(() => ({}));
        // Task 69, scope 1 — true first launch ONLY (status computes
        // firstLaunch BEFORE it records the local trial-start, so reading it
        // after the write would always be false). Every other state
        // (licensed, in-trial, expired, revoked) keeps the deliberate "never
        // block, always continue to hosted app" behavior — only the
        // no-account case shows the account screen that creates the real
        // User + server trial.
        if (data.firstLaunch === true && data.licensed !== true) {
          setPhase("first-launch");
          return;
        }
        setPhase("continuing");
        openHostedApp(
          typeof data.machineId === "string" ? data.machineId : "",
          data.licensed === true,
          typeof data.expiresAtDate === "string" ? data.expiresAtDate : undefined,
        );
      } catch {
        setPhase("unavailable");
      }
    })();
  }, []);

  if (phase === "first-launch") {
    return <ExeFirstLaunch />;
  }

  if (phase === "unavailable") {
    return (
      <Card className="w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-fg">Vantra desktop</h2>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          The local licensing service isn&apos;t available. This screen only runs
          inside the packaged Vantra desktop app.
        </p>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md p-6 text-center">
      <Spinner className="h-6 w-6" />
      <p className="mt-3 text-sm text-fg-muted">Starting Vantra…</p>
    </Card>
  );
}

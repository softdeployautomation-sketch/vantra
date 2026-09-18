"use client";

import { useEffect, useState } from "react";

import { Button, Card, Spinner } from "@/components/ui";
import { LicenseSettings } from "@/components/license-settings";

// Task 44.3 — the thin Vantra EXE license gate. This is the ONLY screen the
// desktop window shows before the hosted app. Everything on this page runs
// against the bundled local runtime (POST /api/exe-license/status), which:
//
//   - silently starts a 24h trial on first launch,
//   - reports `licensed` / `inTrial` / expired,
//   - and is the only thing the dropdown-exe runtime ships locally (no
//     DATABASE_URL, no VPS secrets — see scripts/runtime-assemble.mjs).
//
// When the local license is OK the window is pointed at the hosted app
// (https://vantra.instaweb.top) for everything else (Option 2 architecture).
// When the trial is expired the user activates right here with a key (reusing
// LicenseSettings), and gets handed off to the hosted app on success.

// The hosted Vantra app. Locked to the real production origin — a desktop user
// must always land on the genuine hosted app, never a loopback/dev origin.
const HOSTED_APP_URL = "https://vantra.instaweb.top";

type Phase = "loading" | "unavailable" | "access" | "activate";

export function ExeGate() {
  const [phase, setPhase] = useState<Phase>("loading");

  // Full (cross-origin) navigation to the hosted app. Using window.location
  // replace (not pushState) so the webview actually moves to the hosted origin.
  function openHostedApp() {
    window.location.replace(HOSTED_APP_URL);
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
        const access = data.licensed || data.inTrial;
        setPhase(access ? "access" : "activate");
        if (access) openHostedApp();
      } catch {
        setPhase("unavailable");
      }
    })();
  }, []);

  if (phase === "loading") {
    return (
      <Card className="w-full max-w-md p-6 text-center">
        <Spinner className="h-6 w-6" />
        <p className="mt-3 text-sm text-fg-muted">Checking your license…</p>
      </Card>
    );
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

  if (phase === "access") {
    return (
      <Card className="w-full max-w-md p-6 text-center">
        <p className="text-lg font-semibold text-fg">Starting Vantra…</p>
        <p className="mt-2 text-sm text-fg-muted">Taking you to the app.</p>
      </Card>
    );
  }

  // phase === "activate" — trial expired (or a key is needed). Reuse the same
  // settings component as the in-app License section; on success it calls back
  // so the window can hand off to the hosted app immediately.
  return (
    <div>
      <h2 className="text-lg font-semibold text-fg">Activate Vantra</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Your trial has ended. Enter your license key to continue.
      </p>
      <LicenseSettings onLicensed={openHostedApp} />
      <div className="mt-4">
        <Button variant="ghost" type="button" onClick={() => openHostedApp()}>
          Continue to vantra.instaweb.top anyway
        </Button>
      </div>
    </div>
  );
}
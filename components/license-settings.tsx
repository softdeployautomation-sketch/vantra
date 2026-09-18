"use client";

import { useEffect, useState } from "react";

import { Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";

// Task 44.2 — the Vantra EXE license activation section shown inside Settings.
//
// Backed by the local runtime (no server round-trip for validation): status and
// activate hit the app's own /api/exe-license/* routes, which validate offline
// with the embedded signing secret and persist locally. Those routes are inert
// (404) everywhere except the Tauri-bundled EXE's local runtime, so on the
// hosted web dashboard this section degrades to a neutral "desktop app only"
// note rather than failing.
//
// Statuses rendered:
//   - licensed -> green badge + expiry, no activation form needed
//   - trial    -> amber badge + hours left, AND the activation form (activate
//                 early, not gated behind waiting for trial expiry)
//   - expired  -> red badge + the activation form

type Status =
  | { mode: "loading" }
  | { mode: "unavailable" }
  | { mode: "licensed"; expiresAt?: string; licensee?: string }
  | { mode: "trial"; trialHoursLeft?: number }
  | { mode: "expired"; message?: string };

export function LicenseSettings() {
  const [status, setStatus] = useState<Status>({ mode: "loading" });
  const [licenseKey, setLicenseKey] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [activating, setActivating] = useState(false);

  async function activate() {
    setError("");
    setActivating(true);
    try {
      const res = await fetch("/api/exe-license/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseKey, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.licensed) {
        setStatus({ mode: "licensed", expiresAt: data.expiresAtDate, licensee: data.licensee });
        setLicenseKey("");
        setEmail("");
      } else {
        setError(typeof data.error === "string" ? data.error : "Activation failed. Check the key and email and try again.");
      }
    } catch {
      setError("Network error — could not reach the local licensing service.");
    } finally {
      setActivating(false);
    }
  }

  // Read the local license status on mount (first launch starts the 24h trial
  // silently). A 404 means we're not inside the EXE's local runtime.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/exe-license/status", { method: "POST" });
        if (res.status === 404) {
          setStatus({ mode: "unavailable" });
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (data.licensed) {
          setStatus({ mode: "licensed", expiresAt: data.expiresAtDate, licensee: data.licensee });
        } else if (data.inTrial) {
          setStatus({ mode: "trial", trialHoursLeft: data.trialHoursLeft });
        } else {
          setStatus({ mode: "expired", message: typeof data.message === "string" ? data.message : undefined });
        }
      } catch {
        setStatus({ mode: "expired", message: "Could not confirm your license status." });
      }
    })();
  }, []);

  if (status.mode === "loading") {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-fg">Vantra EXE license</h2>
            <p className="mt-1 text-xs text-fg-muted">Checking local license…</p>
          </div>
          <Spinner className="text-brand-600" />
        </div>
      </Card>
    );
  }

  // Not inside the EXE's local runtime (the hosted web dashboard) — degrade
  // gracefully instead of showing a broken form.
  if (status.mode === "unavailable") {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Vantra EXE license</h2>
            <p className="mt-1 text-xs text-fg-muted">
              Your desktop-app license (trial or activated key) is managed on this
              computer. This section is only active inside the Vantra desktop app.
            </p>
          </div>
          <Badge tone="neutral">Desktop app</Badge>
        </div>
      </Card>
    );
  }

  const licensed = status.mode === "licensed";

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-fg">Vantra EXE license</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Your desktop-app license on this computer. Activation is offline and
            works without an internet connection.
          </p>
        </div>
        {status.mode === "licensed" && <Badge tone="success">Licensed</Badge>}
        {status.mode === "trial" && <Badge tone="warning">Trial</Badge>}
        {status.mode === "expired" && <Badge tone="danger">Expired</Badge>}
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        {status.mode === "licensed" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-fg-muted">Registered to</dt>
              <dd className="text-fg">{status.licensee ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-fg-muted">Expires</dt>
              <dd className="tabular-nums text-fg">
                {status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : "—"}
              </dd>
            </div>
          </>
        )}
        {status.mode === "trial" && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-muted">Trial remaining</dt>
            <dd className="tabular-nums text-fg">
              {typeof status.trialHoursLeft === "number"
                ? `${Math.ceil(status.trialHoursLeft)} hour${Math.ceil(status.trialHoursLeft) === 1 ? "" : "s"}`
                : "—"}
            </dd>
          </div>
        )}
        {status.mode === "expired" && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {status.message ?? "Your trial has ended. Activate with a license key below."}
          </p>
        )}
      </dl>

      {/* Activation form — always available (activate early, before trial ends). */}
      {!licensed ? (
        <div className="mt-5 space-y-4">
          <div>
            <Label htmlFor="exe-license-key">License key</Label>
            <Input
              id="exe-license-key"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="Paste your license key"
            />
          </div>
          <div>
            <Label htmlFor="exe-license-email">Email</Label>
            <Input
              id="exe-license-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          <Button variant="primary" type="button" onClick={activate} disabled={activating}>
            {activating ? <Spinner /> : null} Activate
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-fg-muted">
          This computer is licensed. To change keys, contact Vantra support.
        </p>
      )}
    </Card>
  );
}
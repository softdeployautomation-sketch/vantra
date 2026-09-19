"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Badge, Button, Card, Spinner } from "@/components/ui";
import { EXE_HANDOFF_KEY, type ExeHandoff } from "@/components/workspace-handoff";

// Task — self-service Vantra EXE license. The web-Settings ("desktop-app only"
// placeholder) branch of license-settings.tsx, replaced for eligible users with a
// one-step flow that mints AND binds a license — no admin click anywhere in the
// sequence.
//
//   1. On mount, session-gated GET /api/exe-license/self-service returns the
//      caller's OWN eligibility (premium OR staff), the stable download URL,
//      AND the account's actual current bind status (`bound`) — so Settings
//      reflects reality on every visit, not just the one that happened to
//      arrive via the app's own handoff.
//   2. Ineligible -> upsell prompt (no form, nothing minted).
//   3. Eligible + arrived via the desktop app's auto-handoff -> one click
//      mints AND binds. POST mints (if needed) AND binds, then redirects
//      straight back to the device — zero copy-paste.
//   4. Eligible, opened Settings directly (no device context) and NOT yet
//      bound anywhere -> "Generate license" (no Device ID field — POST with
//      no machineId just mints/reuses an UNBOUND key) + "Download desktop
//      app". Opening the app afterward completes activation automatically
//      via #3, no key to copy.
//   5. Eligible and the account IS already bound somewhere -> status only
//      ("Licensed to <label>"), no raw Device ID, no controls — device
//      moves happen by opening the app on the new machine (#3's auto-
//      transfer), not by managing bindings from the web.
//
// No-manual-entry redesign (2026-09-19) — there is deliberately no "paste
// your Device ID here" fallback anymore. Device swaps are handled by opening
// the app on a NEW machine, which re-registers automatically and instantly
// supersedes the old machine's bound key (self-service/route.ts's
// auto-transfer) — surfaced here as an explicit warning before "Register
// this device" whenever the account is already bound to a DIFFERENT device.

interface Status {
  mode: "loading" | "ready" | "up-sell";
  eligible: boolean;
  isStaff: boolean;
  plan: string | null;
  downloadUrl: string;
  email: string;
  bound: { machineLabel: string | null; expiresAt: string } | null;
}

export function ExeLicenseSelfService() {
  const searchParams = useSearchParams();
  // URL params first (a direct /workspace?deviceId=... visit), falling back to
  // the sessionStorage handoff workspace-handoff.tsx stashed — the realistic
  // path, since Settings is reached through the Dashboard iframe + at least
  // one in-iframe navigation, which drops query strings entirely. Computed
  // once via the lazy initializer (not an effect + setState) since this is
  // reading an external source to seed initial state, not synchronizing an
  // ongoing external change.
  const [handoff] = useState<ExeHandoff>(() => {
    const urlDeviceId = searchParams.get("deviceId")?.trim() || "";
    if (urlDeviceId) {
      return {
        deviceId: urlDeviceId,
        deviceLabel: searchParams.get("deviceLabel")?.trim() || "",
        returnOrigin: searchParams.get("returnOrigin")?.trim() || "",
        licensed: searchParams.get("licensed") === "1",
        expiresAt: searchParams.get("expiresAt")?.trim() || undefined,
      };
    }
    try {
      const raw = sessionStorage.getItem(EXE_HANDOFF_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ExeHandoff>;
        if (parsed.deviceId) {
          return {
            deviceId: parsed.deviceId,
            deviceLabel: parsed.deviceLabel ?? "",
            returnOrigin: parsed.returnOrigin ?? "",
            licensed: parsed.licensed === true,
            expiresAt: parsed.expiresAt,
          };
        }
      }
    } catch {
      // Unavailable or unparsable — falls through to the "open the app" prompt.
    }
    return { deviceId: "", deviceLabel: "", returnOrigin: "", licensed: false };
  });
  const {
    deviceId: handoffDeviceId,
    deviceLabel: handoffDeviceLabel,
    returnOrigin,
    licensed: handoffLicensed,
    expiresAt: handoffExpiresAt,
  } = handoff;

  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    void (async () => {
    try {
      const res = await fetch("/api/exe-license/self-service", { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({
          mode: "ready",
          eligible: false,
          isStaff: false,
          plan: null,
          downloadUrl: "",
          email: "",
          bound: null,
        });
        setError(typeof data.error === "string" ? data.error : "Could not check license access.");
        return;
      }
      setStatus({
        mode: data.eligible ? "ready" : "up-sell",
        eligible: data.eligible === true,
        isStaff: data.isStaff === true,
        plan: data.plan ?? null,
        downloadUrl: typeof data.downloadUrl === "string" ? data.downloadUrl : "",
        email: typeof data.email === "string" ? data.email : "",
        bound:
          data.bound && typeof data.bound === "object"
            ? {
                machineLabel: typeof data.bound.machineLabel === "string" ? data.bound.machineLabel : null,
                expiresAt: typeof data.bound.expiresAt === "string" ? data.bound.expiresAt : "",
              }
            : null,
      });
    } catch {
      setStatus({
        mode: "ready",
        eligible: false,
        isStaff: false,
        plan: null,
        downloadUrl: "",
        email: "",
        bound: null,
      });
      setError("Network error — could not check license access.");
    }
    })();
  }, []);

  async function register() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/exe-license/self-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId: handoffDeviceId, machineLabel: handoffDeviceLabel || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : "Could not register this device — try again.";
        if (typeof data.error === "string" && data.error.toLowerCase().includes("premium")) {
          setStatus((s) => (s ? { ...s, mode: "up-sell", eligible: false } : s));
        }
        setError(msg);
        return;
      }
      if (data.ok && data.license && returnOrigin && status?.email) {
        try {
          sessionStorage.removeItem(EXE_HANDOFF_KEY);
        } catch {
          // Not critical — worst case the next Settings visit re-checks a
          // now-idempotent register (findOrMintAndBind just returns the
          // same bound license again).
        }
        const back = new URLSearchParams({ key: data.license.licenseKey, email: status.email });
        window.location.href = `${returnOrigin}/activate-complete?${back.toString()}`;
        return;
      }
      setError("Unexpected response — try again.");
    } catch {
      setError("Network error — could not reach the licensing service.");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/exe-license/self-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not generate a license — try again.");
        return;
      }
      setGenerated(true);
    } catch {
      setError("Network error — could not reach the licensing service.");
    } finally {
      setBusy(false);
    }
  }

  // ── loading ──────────────────────────────────────────────────────────────
  if (!status) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner /> Checking license access…
        </div>
      </Card>
    );
  }

  // ── ineligible → upsell, nothing minted ─────────────────────────────────
  if (status.mode === "up-sell") {
    return (
      <Card className="p-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-bold text-fg">Vantra Desktop</span>
          <Badge tone="neutral">Premium</Badge>
        </div>
        <p className="mb-4 text-sm text-fg-muted">
          The Vantra desktop app runs locally on your machine and needs its own
          license, tied to one computer. A license is included with a premium
          plan — upgrade to generate one.
        </p>
        {error ? (
          <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              if (status.downloadUrl) window.open(status.downloadUrl, "_blank");
            }}
          >
            Download desktop app
          </Button>
        </div>
      </Card>
    );
  }

  // ── this exact device is already licensed ───────────────────────────────
  // Confirmed live (2026-09-19) — without this, Settings always fell back to
  // the registration form on a revisit, even right after a successful
  // activation, because it had no way to know THIS device's local state
  // beyond the one-shot handoff. exe-gate.tsx now includes its own
  // /api/exe-license/status result in that same handoff.
  if (handoffDeviceId && handoffLicensed) {
    return (
      <Card className="p-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-bold text-fg">Vantra Desktop license</span>
          <Badge tone="success">Licensed</Badge>
        </div>
        <p className="text-sm text-fg-muted">
          {handoffDeviceLabel || "This device"} is licensed
          {handoffExpiresAt ? ` until ${new Date(handoffExpiresAt).toLocaleDateString()}` : ""}.
        </p>
      </Card>
    );
  }

  // ── eligible + arrived via the desktop app's auto-handoff ──────────────
  // Device ID is already known (exe-gate.tsx put it in the URL) — one button,
  // no typing. Success redirects back to the device instead of showing a key.
  if (handoffDeviceId) {
    const movingFromAnotherDevice =
      !!status.bound && (status.bound.machineLabel ?? "") !== (handoffDeviceLabel || "");
    return (
      <Card className="p-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-bold text-fg">Vantra Desktop license</span>
          {status.isStaff ? <Badge tone="warning">Staff</Badge> : <Badge tone="success">Premium</Badge>}
        </div>
        <p className="mb-4 text-sm text-fg-muted">
          {handoffDeviceLabel || "This device"} isn&apos;t activated yet. One click locks a
          license to it and finishes setup automatically.
        </p>
        {movingFromAnotherDevice ? (
          <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300">
            Your license is currently active on {status.bound?.machineLabel || "another device"}.
            Registering this device moves it here and deactivates that one immediately.
          </p>
        ) : null}
        {error ? (
          <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        ) : null}
        <Button onClick={() => void register()} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : null} Register this device
        </Button>
      </Card>
    );
  }

  // ── eligible, opened Settings directly, account already bound somewhere ──
  // Status only — no raw Device ID, no transfer/unbind controls here. Moving
  // to a new machine happens by opening the app there (case above).
  if (status.bound) {
    return (
      <Card className="p-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-bold text-fg">Vantra Desktop license</span>
          <Badge tone="success">Licensed</Badge>
        </div>
        <p className="text-sm text-fg-muted">
          Active on {status.bound.machineLabel || "one device"}
          {status.bound.expiresAt ? ` until ${new Date(status.bound.expiresAt).toLocaleDateString()}` : ""}.
          To move it to a different computer, open the desktop app there —
          it takes over automatically.
        </p>
      </Card>
    );
  }

  // ── eligible, opened Settings directly, not bound anywhere yet ──────────
  return (
    <Card className="p-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-bold text-fg">Vantra Desktop license</span>
        {status.isStaff ? <Badge tone="warning">Staff</Badge> : <Badge tone="success">Premium</Badge>}
      </div>
      {generated ? (
        <p className="mb-4 text-sm text-fg-muted">
          License ready. Open the desktop app on the computer you want to
          license — it detects your account and finishes activating
          automatically. Nothing to copy or paste.
        </p>
      ) : (
        <p className="mb-4 text-sm text-fg-muted">
          Generate a license, then open the desktop app — it activates that
          computer automatically. Generating again later moves your license
          to whichever device you open the app on next.
        </p>
      )}
      {error ? (
        <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!generated ? (
          <Button onClick={() => void generate()} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : null} Generate license
          </Button>
        ) : null}
        {status.downloadUrl ? (
          <Button
            variant="secondary"
            onClick={() => {
              window.open(status.downloadUrl, "_blank");
            }}
          >
            Download desktop app
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

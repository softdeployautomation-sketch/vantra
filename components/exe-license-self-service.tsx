"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { EXE_HANDOFF_KEY, type ExeHandoff } from "@/components/workspace-handoff";

// Task — self-service Vantra EXE license. The web-Settings ("desktop-app only"
// placeholder) branch of license-settings.tsx, replaced for eligible users with a
// one-step flow that mints AND binds a license — no admin click anywhere in the
// sequence.
//
//   1. On mount, session-gated GET /api/exe-license/self-service returns the
//      caller's OWN eligibility (premium OR staff) + the stable download URL.
//   2. Ineligible -> upsell prompt (no form, nothing minted).
//   3. Eligible -> mint AND bind. POST mints (if needed) AND binds; the
//      response is an already-bound key. Idempotent server-side: repeat
//      clicks never mint duplicate licenses.
//
// Self-service redesign (2026-09-19) — two ways to reach step 3:
//
//   a) Auto-handoff: reached via exe-gate.tsx's redirect, carrying
//      ?deviceId=&deviceLabel=&returnOrigin= for THIS device. The Device ID
//      is already known, so there's no form at all — one "Register this
//      device" button, and on success this redirects straight back to
//      returnOrigin's /activate-complete?key=&email= to finish LOCAL
//      activation with zero copy-paste (matches how the standalone
//      lead-extractor always auto-detected + verified its own machine).
//   b) Manual (no deviceId param — e.g. opened Settings from an ordinary
//      browser to pre-generate a key before installing anywhere): the
//      original Device ID input + Generate + copy-the-key flow, unchanged.

interface Status {
  mode: "loading" | "ready" | "up-sell";
  eligible: boolean;
  isStaff: boolean;
  plan: string | null;
  downloadUrl: string;
  email: string;
}

interface IssuedResult {
  exeLicenseId: string;
  licenseKey: string;
  boundMachineId: string;
  boundMachineLabel: string | null;
  isNew: boolean;
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
          };
        }
      }
    } catch {
      // Unavailable or unparsable — falls through to the manual flow.
    }
    return { deviceId: "", deviceLabel: "", returnOrigin: "" };
  });
  const { deviceId: handoffDeviceId, deviceLabel: handoffDeviceLabel, returnOrigin } = handoff;

  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [machineId, setMachineId] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedResult | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/exe-license/self-service", { method: "GET" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus({ mode: "ready", eligible: false, isStaff: false, plan: null, downloadUrl: "", email: "" });
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
        });
      } catch {
        setStatus({ mode: "ready", eligible: false, isStaff: false, plan: null, downloadUrl: "", email: "" });
        setError("Network error — could not check license access.");
      }
    })();
  }, []);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 1500);
    } catch {
      // Clipboard unavailable — the value is still selectable manually.
    }
  }

  async function generate(overrideId?: string, overrideLabel?: string) {
    const id = (overrideId ?? machineId).trim();
    if (!id) {
      setError("Enter the Device ID shown on your desktop app.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/exe-license/self-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId: id, machineLabel: overrideLabel ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : "Could not generate your license. If it's already active on another device, contact support to transfer it.";
        if (typeof data.error === "string" && data.error.toLowerCase().includes("premium")) {
          setStatus((s) => (s ? { ...s, mode: "up-sell", eligible: false } : s));
        }
        setIssued(null);
        setError(msg);
        return;
      }
      if (data.ok && data.license) {
        // Auto-handoff: hand the finished key straight back to the device that
        // sent us here — it finishes activating itself, no copy-paste. Only
        // when we actually arrived via the redirect (returnOrigin present);
        // the manual flow (below) still shows the key to copy.
        if (returnOrigin && status?.email) {
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
        setIssued({
          exeLicenseId: data.license.exeLicenseId,
          licenseKey: data.license.licenseKey,
          boundMachineId: data.license.boundMachineId,
          boundMachineLabel: data.license.boundMachineLabel ?? null,
          isNew: data.license.isNew === true,
        });
        setError("");
      } else {
        setError("Unexpected response — try again.");
      }
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

  // ── eligible + arrived via the desktop app's auto-handoff ──────────────
  // Device ID is already known (exe-gate.tsx put it in the URL) — one button,
  // no typing. Success redirects back to the device instead of showing a key.
  if (handoffDeviceId && !issued) {
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
        {error ? (
          <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        ) : null}
        <Button onClick={() => generate(handoffDeviceId, handoffDeviceLabel)} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : null} Register this device
        </Button>
      </Card>
    );
  }

  // ── eligible → one-step mint + bind (manual: opened Settings directly) ──
  return (
    <Card className="p-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-bold text-fg">Vantra Desktop license</span>
        {status.isStaff ? <Badge tone="warning">Staff</Badge> : <Badge tone="success">Premium</Badge>}
      </div>

      {issued ? (
        <div className="mb-4 space-y-3 rounded-lg border border-border bg-bg px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-fg">Your license</span>
            <Badge tone={issued.isNew ? "success" : "neutral"}>
              {issued.isNew ? "New" : "Existing"}
            </Badge>
          </div>
          <code className="block rounded-lg bg-black/5 px-3 py-2 text-xs break-all text-fg dark:bg-white/5">
            {issued.licenseKey}
          </code>
          <p className="text-xs text-fg-muted">
            Bound to Device ID{" "}
            <span className="font-mono">{issued.boundMachineId}</span>
            {issued.boundMachineLabel ? ` (${issued.boundMachineLabel})` : ""}. Paste
            this key into the desktop app&apos;s Settings → License to activate.
          </p>
          <Button variant="secondary" onClick={() => copy(issued.licenseKey)}>
            {copiedKey ? "Copied" : "Copy key"}
          </Button>
          {status.downloadUrl ? (
            <a
              href={status.downloadUrl}
              className="inline-block text-sm text-brand-600 hover:underline dark:text-brand-400"
            >
              Download the desktop app
            </a>
          ) : null}
        </div>
      ) : null}

      <Label htmlFor="device-id">Device ID</Label>
      <div className="flex gap-2">
        <Input
          id="device-id"
          value={machineId}
          onChange={(e) => setMachineId(e.target.value)}
          placeholder="Paste the Device ID from your installed desktop app"
          autoComplete="off"
          disabled={busy}
        />
        <Button onClick={() => generate()} disabled={busy || !machineId.trim()}>
          {busy ? <Spinner className="h-4 w-4" /> : null} Generate license
        </Button>
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        Open the desktop app, copy the Device ID it shows, paste it here. Your
        license is generated and locked to that computer in one step.
      </p>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

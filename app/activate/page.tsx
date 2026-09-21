"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";

// Task 69, scope 4 — the directly-reachable "load license" page (hosted,
// session + login form, NOT the local EXE runtime). A user with a license
// (post-upgrade) on a fresh machine, with no Device-ID handoff, can log in
// (existing /api/auth/login) then trigger the EXISTING bind/transfer flow
// (POST /api/exe-license/self-service with THIS machine's auto-detected UUID
// from ?deviceId= / sessionStorage handoff). Wiring, not new binding logic.
function ActivateInner() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  // URL handoff seeds initial state above (lazy initializer); the
  // sessionStorage fallback is read lazily too — no effect needed (same
  // pattern as exe-license-self-service's handoff initializer).
  const [deviceIdFallback] = useState(() => {
    if (params.get("deviceId")?.trim()) return { id: "", label: "" };
    try {
      const raw = sessionStorage.getItem("vantra:exe-handoff");
      if (raw) {
        const parsed = JSON.parse(raw) as { deviceId?: string; deviceLabel?: string };
        if (parsed.deviceId) return { id: parsed.deviceId, label: parsed.deviceLabel ?? "" };
      }
    } catch {
      // No handoff — user can still log in; register step will say so.
    }
    return { id: "", label: "" };
  });
  const deviceId = params.get("deviceId")?.trim() || deviceIdFallback.id;
  const deviceLabel = params.get("deviceLabel")?.trim() || deviceIdFallback.label;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't sign you in.");
        return;
      }
      setLoggedIn(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setError("");
    setBusy(true);
    try {
      if (!deviceId) {
        setError("We couldn't detect this device. Open the desktop app once, then return here.");
        return;
      }
      const res = await fetch("/api/exe-license/self-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId: deviceId, machineLabel: deviceLabel || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't load your license.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="w-full max-w-md p-6 text-center">
        <Badge tone="success">Licensed</Badge>
        <h2 className="mt-2 text-lg font-semibold text-fg">This device is licensed</h2>
        <p className="mt-2 text-sm text-fg-muted">Open the desktop app — it picks it up automatically.</p>
      </Card>
    );
  }

  if (!loggedIn) {
    return (
      <Card className="w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-fg">Load your license</h2>
        <p className="mt-1 text-sm text-fg-muted">Sign in — we move your license onto this computer.</p>
        <form onSubmit={login} className="mt-4 space-y-4">
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <div>
            <Label htmlFor="activate-email">Email</Label>
            <Input id="activate-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <Label htmlFor="activate-password">Password</Label>
            <Input id="activate-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Spinner className="h-4 w-4" /> : null} Sign in
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md p-6">
      <h2 className="text-lg font-semibold text-fg">Move your license here</h2>
      <p className="mt-1 text-sm text-fg-muted">Signed in as {email}. Registering moves your license here.</p>
      {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <Button onClick={() => void register()} disabled={busy} className="mt-4 w-full">
        {busy ? <Spinner className="h-4 w-4" /> : null} Register this device
      </Button>
    </Card>
  );
}

export default function ActivatePage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }} className="bg-bg px-4">
      <Suspense fallback={<Card className="w-full max-w-md p-6 text-center"><Spinner className="h-6 w-6" /></Card>}>
        <ActivateInner />
      </Suspense>
    </main>
  );
}

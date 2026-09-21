"use client";

import { useEffect, useState } from "react";

import { Card, Spinner } from "@/components/ui";

// Task 69, scope 1 — the EXE's first-launch account screen. Rendered by the
// bundled local runtime ONLY on a true first launch (status's `firstLaunch`
// flag — every other state keeps exe-gate's "always continue to hosted app"
// behavior exactly as-is). Collects email + password and posts SAME-ORIGIN
// to /api/exe-license/trial-start (the local proxy for hosted
// POST /api/exe-trial/start, which creates the real User via the shared
// auth helper or logs into an existing one, and starts the server-side 24h
// trial tied to userId). Carries the returned session token + device id to
// the hosted app, which plants the session cookie (via /api/exe-license/
// enter) before landing — so the user arrives logged IN, not at a login wall.
const HOSTED_APP_URL = "https://vantra.instaweb.top";

export function ExeFirstLaunch() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [machineId, setMachineId] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/exe-license/status", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (typeof data.machineId === "string") setMachineId(data.machineId);
      } catch {
        // Non-fatal — the continue path still works without it.
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // SAME-ORIGIN post to the local runtime: it proxies to the hosted
      // trial route server-side (no CORS, no third-party-cookie loss) and
      // returns the hosted session token for the redirect hop to plant.
      const res = await fetch("/api/exe-license/trial-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't start your trial — try again.");
        return;
      }
      const accountEmail = typeof data.email === "string" ? data.email : email;
      // New account needing verification: route through the hosted enter hop
      // with ?next=/verify?... — a Server Component CANNOT set cookies, so
      // linking straight to /verify would drop the session; the hop plants
      // the cookie first, then lands on verify AUTHENTICATED (the code form
      // submits with the session present).
      const sessionToken = typeof data.sessionToken === "string" ? data.sessionToken : "";
      if (data.needsVerification && data.isNewAccount) {
        const next = new URLSearchParams({ email: accountEmail });
        if (machineId) next.set("deviceId", machineId);
        const params = new URLSearchParams({ next: `/verify?${next.toString()}` });
        if (sessionToken) params.set("sessionToken", sessionToken);
        window.location.replace(`${HOSTED_APP_URL}/api/exe-license/enter?${params.toString()}`);
        return;
      }
      // Existing (or already-verified) account: hand the session token + device
      // to the hosted enter hop, which plants the session cookie server-side
      // and lands on /workspace — no login wall.
      const params = new URLSearchParams({ source: "exe", firstLaunch: "1" });
      if (sessionToken) params.set("sessionToken", sessionToken);
      if (machineId) {
        params.set("deviceId", machineId);
        params.set(
          "deviceLabel",
          typeof navigator !== "undefined" && navigator.platform ? navigator.platform : "This device",
        );
      }
      window.location.replace(`${HOSTED_APP_URL}/api/exe-license/enter?${params.toString()}`);
    } catch {
      setError("Couldn't reach the account server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-md p-6">
      <h2 className="text-lg font-semibold text-fg">Start your free trial</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Enter your email and a password to create your Vantra account and start your 24-hour free trial.
        Already have an account? Use the same email and password — we&apos;ll log you in instead.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        {error ? (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        ) : null}
        <div>
          <label htmlFor="exe-first-launch-email" className="mb-1 block text-sm font-medium text-fg">
            Email
          </label>
          <input
            id="exe-first-launch-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-fg placeholder:text-fg-muted/70 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        <div>
          <label htmlFor="exe-first-launch-password" className="mb-1 block text-sm font-medium text-fg">
            Password
          </label>
          <input
            id="exe-first-launch-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-fg placeholder:text-fg-muted/70 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-60"
        >
          {busy ? <Spinner className="h-4 w-4" /> : null} Start free trial
        </button>
        <p className="text-center text-xs text-fg-muted">
          <a
            href={`${HOSTED_APP_URL}/support-contact`}
            target="_blank"
            rel="noreferrer"
            className="text-brand-600 hover:underline dark:text-brand-400"
          >
            Locked out? Contact us
          </a>
        </p>
      </form>
    </Card>
  );
}

import { NextResponse } from "next/server";

import { exeLicenseSecret } from "@/lib/exe-license";
import { validateLicenseKey } from "@/lib/exe-license-validator";
import { isLocalExeRuntime } from "@/lib/exe-runtime";
import { defaultSyncHost } from "@/lib/local-db/sync";
import { getMachineId, validateMachineId } from "@/lib/machine-id";
import {
  clearActivation,
  readLocalState,
  startTrialIfNeeded,
  trialActive,
  trialHoursLeft,
  TRIAL_HOURS,
} from "@/lib/license-state";

/**
 * Best-effort LIVE revocation check (revocation-on-transfer task, 2026-09-18).
 * Offline-first: any network failure fails OPEN (returns true, "still valid")
 * so a legitimately offline user is never locked out — this is a "catch it
 * when we can reach the server" check, not a hard guarantee, consistent with
 * the whole app's offline-capable design. Short timeout so a flaky connection
 * never makes every launch feel slow.
 *
 * Reuses /api/exe-license/eligibility, which already 404s when the presented
 * key is no longer this license's current binding (see that route's comment)
 * — exactly the signal a transferred-away machine needs to catch.
 */
async function stillValidLive(licensee: string, licenseKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${defaultSyncHost()}/api/exe-license/eligibility`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: licensee, licenseKey }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      // Only 404 ("Unknown license" — this exact key is no longer the
      // current binding, i.e. transferred away) is a genuine revocation
      // signal. Any other non-2xx (400 bad request, 500 server error, ...)
      // is server/request trouble, not proof of revocation — fail open.
      return res.status !== 404;
    }
    const data = await res.json().catch(() => ({}));
    return data.eligible !== false;
  } catch {
    // Unreachable (offline, DNS, timeout, ...) — fail open.
    return true;
  }
}

// POST /api/exe-license/status — the LOCAL licensing gate status, read from this
// machine's filesystem (no database, no session auth — see lib/exe-runtime.ts
// for why that's safe: VANTRA_LOCAL_EXE gates this to the Tauri-bundled local
// runtime only, fail-closed, never set on the deployed web server). This is the
// same code that runs inside the desktop EXE's bundled local runtime; it is only
// mounted by the EXE shell, never by the hosted web dashboard.
//
// Returns the decision the license status UI renders on:
//   - licensed       -> user has an active, machine-valid key -> show "licensed"
//   - inTrial        -> unlicensed but first launch was < 24h ago -> show "trial"
//   - otherwise      -> trial exhausted / activation invalid -> show "expired"
export async function POST() {
  if (!isLocalExeRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const preState = await readLocalState();

  // Task 44.2b — surface this device's ID to every status response so the EXE's
  // license UI can show it (copyable). The admin claim tool needs this ID to bind
  // the buyer's machine. getMachineId() is local & deterministic — no server.
  const machineId = (await getMachineId()).toLowerCase();

  // 1. A stored activation wins if the key is still valid on THIS machine.
  if (preState.activation) {
    try {
      const secret = exeLicenseSecret();
      const currentMachineId = machineId;
      const validation = await validateLicenseKey(preState.activation.licenseKey, secret, {
        currentMachineId,
      });

      if (validation.valid && validateMachineId(preState.activation.machineId, currentMachineId)) {
        // Revocation-on-transfer: the offline signature check above only
        // proves the key was validly signed and bound to THIS machine at
        // activation time — it can never know if an admin has since
        // transferred the license elsewhere, since it has no DB access by
        // design. This live check is the one place that can catch it.
        // Best-effort and offline-tolerant (see stillValidLive) — never
        // blocks legitimate offline use, only catches it when reachable.
        const stillValid = await stillValidLive(
          validation.licensee,
          preState.activation.licenseKey,
        );
        if (!stillValid) {
          await clearActivation();
          return NextResponse.json({
            licensed: false,
            inTrial: false,
            machineId,
            message:
              "This license has been moved to a different device. Contact support if this wasn't expected.",
          });
        }

        return NextResponse.json({
          licensed: true,
          machineId,
          licensee: validation.licensee,
          plan: validation.plan,
          expiresAt: validation.expiresAt,
          expiresAtDate: validation.expiresAtDate?.toISOString(),
          licensedAt: preState.activation.activatedAt,
        });
      }

      // Stored key failed — distinguish a copied binding from a genuinely dead key.
      const copied = preState.activation.machineId.toLowerCase() !== currentMachineId;
      const message = copied
        ? "This license is bound to another computer. Enter a license for this machine, or activate with the key you purchased."
        : validation.error;
      return NextResponse.json({ licensed: false, inTrial: false, machineId, message });
    } catch {
      // Signing secret not configured on this machine — cannot validate the key.
      return NextResponse.json(
        { licensed: false, inTrial: false, machineId, message: "Licensing is not configured on this device." },
        { status: 500 },
      );
    }
  }

  // 2. No activation yet — the LOCAL 24h trial is only a fast offline cache.
  // Task 69, scope 1: the server row (User.trialStartedAt, reached via
  // POST /api/exe-trial/reconcile with this machine's cached trial email) is
  // authoritative, so wiping local state can never re-trial. Local file
  // state still starts/caches the window for offline UI; reconcile narrows
  // it to the server window (never widens) when reachable, and fails open
  // (local window stands) when offline.
  //
  // firstLaunch is captured BEFORE startTrialIfNeeded writes: exe-gate shows
  // the account screen only on a true first launch (no activation AND no
  // local trial-start AND no cached trial account yet). Reading it after the
  // write would always be false and the screen would never appear.
  const firstLaunch = !preState.activation && !preState.trialStartedAt && !preState.trialEmail;
  const started = await startTrialIfNeeded();
  const now = new Date();
  const reconciled = await reconcileTrialWithServer(started.trialStartedAt, started.trialEmail);
  // Reconcile returns a narrowed window, not full local state — trialActive
  // only reads trialStartedAt, so spread the live state with the effective
  // start rather than passing the narrow object directly.
  const effective = { ...started, trialStartedAt: reconciled.trialStartedAt };

  if (trialActive(effective, now)) {
    const hoursLeft = trialHoursLeft(effective, now);
    return NextResponse.json({
      licensed: false,
      inTrial: true,
      machineId,
      firstLaunch,
      trialHoursLeft: hoursLeft,
      trialStartedAt: reconciled.trialStartedAt,
      trialEndsAt: new Date(
        new Date(reconciled.trialStartedAt ?? now.toISOString()).getTime() +
          TRIAL_HOURS * 60 * 60 * 1000,
      ).toISOString(),
      trialServerAuthoritative: reconciled.serverAuthoritative,
    });
  }

  return NextResponse.json({
    licensed: false,
    inTrial: false,
    machineId,
    firstLaunch,
    trialStartedAt: reconciled.trialStartedAt,
  });
}

/**
 * Task 69 — reconcile the local trial window against the server authority.
 * Local state caches the trial email (set when the first-launch account
 * screen creates/logs-in the account); the hosted /api/exe-trial/reconcile
 * answers with that account's real trialStartedAt. The effective window is
 * the EARLIER of the two starts (server can only narrow, never extend), so
 * a wiped-and-restarted local clock collapses straight back onto the server
 * window. Offline/unreachable/server-unknown all fail open to the local
 * window — this route must never lock out a legitimately offline trial.
 */
async function reconcileTrialWithServer(
  localStartedAt: string | undefined,
  trialEmail: string | undefined,
): Promise<{ trialStartedAt?: string; trialEmail?: string; serverAuthoritative: boolean }> {
  if (!trialEmail || !localStartedAt) return { trialStartedAt: localStartedAt, serverAuthoritative: false };
  try {
    const res = await fetch(`${defaultSyncHost()}/api/exe-trial/reconcile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: trialEmail }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return { trialStartedAt: localStartedAt, trialEmail, serverAuthoritative: false };
    const data = await res.json().catch(() => ({}));
    if (typeof data.trialStartedAt !== "string" || !data.trialStartedAt) {
      return { trialStartedAt: localStartedAt, trialEmail, serverAuthoritative: false };
    }
    const serverStart = new Date(data.trialStartedAt).getTime();
    const localStart = new Date(localStartedAt).getTime();
    if (Number.isNaN(serverStart)) return { trialStartedAt: localStartedAt, trialEmail, serverAuthoritative: false };
    // Server wins when it started earlier (the wipe-and-re-trial case); a
    // NEWER server start than local can only mean clock skew — keep local.
    const effective =
      !Number.isNaN(localStart) && localStart < serverStart ? localStartedAt : data.trialStartedAt;
    return { trialStartedAt: effective, trialEmail, serverAuthoritative: true };
  } catch {
    return { trialStartedAt: localStartedAt, trialEmail, serverAuthoritative: false };
  }
}
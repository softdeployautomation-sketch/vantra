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

  const state = await readLocalState();

  // Task 44.2b — surface this device's ID to every status response so the EXE's
  // license UI can show it (copyable). The admin claim tool needs this ID to bind
  // the buyer's machine. getMachineId() is local & deterministic — no server.
  const machineId = (await getMachineId()).toLowerCase();

  // 1. A stored activation wins if the key is still valid on THIS machine.
  if (state.activation) {
    try {
      const secret = exeLicenseSecret();
      const currentMachineId = machineId;
      const validation = await validateLicenseKey(state.activation.licenseKey, secret, {
        currentMachineId,
      });

      if (validation.valid && validateMachineId(state.activation.machineId, currentMachineId)) {
        // Revocation-on-transfer: the offline signature check above only
        // proves the key was validly signed and bound to THIS machine at
        // activation time — it can never know if an admin has since
        // transferred the license elsewhere, since it has no DB access by
        // design. This live check is the one place that can catch it.
        // Best-effort and offline-tolerant (see stillValidLive) — never
        // blocks legitimate offline use, only catches it when reachable.
        const stillValid = await stillValidLive(
          validation.licensee,
          state.activation.licenseKey,
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
          licensedAt: state.activation.activatedAt,
        });
      }

      // Stored key failed — distinguish a copied binding from a genuinely dead key.
      const copied = state.activation.machineId.toLowerCase() !== currentMachineId;
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

  // 2. No activation yet — honour the silent 24h trial.
  const started = await startTrialIfNeeded();
  const now = new Date();

  if (trialActive(started, now)) {
    const hoursLeft = trialHoursLeft(started, now);
    return NextResponse.json({
      licensed: false,
      inTrial: true,
      machineId,
      trialHoursLeft: hoursLeft,
      trialStartedAt: started.trialStartedAt,
      trialEndsAt: new Date(
        new Date(started.trialStartedAt ?? now.toISOString()).getTime() +
          TRIAL_HOURS * 60 * 60 * 1000,
      ).toISOString(),
    });
  }

  return NextResponse.json({
    licensed: false,
    inTrial: false,
    machineId,
    trialStartedAt: started.trialStartedAt,
  });
}
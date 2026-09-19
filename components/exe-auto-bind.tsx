"use client";

import { useEffect } from "react";

import { EXE_HANDOFF_KEY, type ExeHandoff } from "@/components/workspace-handoff";

// Confirmed live (2026-09-19) — closes a real gap: exe-gate.tsx's handoff to
// /workspace?deviceId=... can land on a user who isn't logged in yet (first
// launch shows a login screen inside the embedded browser). workspace-
// handoff.tsx still stashes the device id to sessionStorage at that moment,
// but there was previously no automatic follow-through once they actually
// logged in — a user could sign into their premium account on any number of
// separate EXE installs and get full working access on every one of them,
// since nothing ever forced the "claim this device" step to happen.
//
// Mounted once at the dashboard layout level (renders on every authenticated
// dashboard page, for every user) — cheap no-op for a normal browser session
// with no stashed handoff. For a genuine EXE session that hasn't bound this
// device yet, it silently mints/reuses and binds the account's license to it
// the moment a real session exists — reusing the exact same self-service
// endpoint (and its auto-transfer / cross-account conflict guard) the manual
// "Register this device" button already calls, so a second device logging in
// with the same account instantly takes over the binding, and the first
// device gets signed out on its next request (getCurrentUser()'s revocation
// check). Never blocks rendering, never shows anything — the manual button in
// Settings stays as a visible fallback if this silent attempt didn't fire
// (ineligible account, or a transient network error).
export function ExeAutoBind() {
  useEffect(() => {
    void (async () => {
      let handoff: ExeHandoff | null = null;
      try {
        const raw = sessionStorage.getItem(EXE_HANDOFF_KEY);
        if (!raw) return;
        handoff = JSON.parse(raw) as ExeHandoff;
      } catch {
        return;
      }
      if (!handoff?.deviceId || handoff.licensed) return;

      try {
        const res = await fetch("/api/exe-license/self-service", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineId: handoff.deviceId, machineLabel: handoff.deviceLabel || null }),
        });
        if (!res.ok) return; // ineligible account, or transient — Settings' manual button still works

        try {
          sessionStorage.setItem(
            EXE_HANDOFF_KEY,
            JSON.stringify({ ...handoff, licensed: true } satisfies ExeHandoff),
          );
        } catch {
          // Not critical — worst case Settings shows the registration state
          // once more on this visit even though binding already succeeded.
        }
        void fetch("/api/exe-license/remember-device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: handoff.deviceId }),
        }).catch(() => {});
      } catch {
        // Network error — harmless, Settings' manual "Register this device"
        // button is the fallback.
      }
    })();
  }, []);

  return null;
}

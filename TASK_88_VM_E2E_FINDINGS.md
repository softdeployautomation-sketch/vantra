# Task 88 — VM E2E findings (2026-09-22): 2 bugs + 1 hygiene item

**Source:** owner's VM test of the rebuilt EXEs (Task 84 steps 7). Host
verification PASSED server-side (see log evidence at the bottom) — the
items below are product/UX bugs, not domain issues.

## BUG-1 — Locked-out support flow dead-ends (Vantra)

- Repro: sign-in page → "Locked out? Contact us without signing in" →
  submit the form → "Message received" screen. **No link/button back** to
  the sign-in page or dashboard; the flow is a dead end.
- Expected: "Message received" screen gets a "Back to sign in" link (and
  ideally the header "Dashboard" tab is hidden on this screen for signed-
  out users, or clicking it goes to /).
- Priority: high-visibility, trivial fix.

## BUG-2 — Vantra admin lacks the 24h-EXE-trial monitor (SpaceWorker parity)

- Repro: admin → user detail → EXE Licenses section (Issue/Search/Licenses
  work) — but there is **no "24h window trials" view** like SpaceWorker's
  admin has, where you see each user's trial and watch it drain.
- Expected: parity with SpaceWorker — a trial monitor listing users with
  active 24h EXE trials and remaining time. Data exists server-side
  (`/api/exe-trial/status` was live during the test; trial state is
  recorded on trial-start).
- Priority: admin-visibility gap; needed before marketing the EXE.

## ITEM-3 — DevTools enabled in SpaceWorker release build (hygiene)

- `spaceworker/src-tauri/Cargo.toml:28`:
  `tauri = { version = "2", features = ["devtools"] }` — left on from a
  debug session. Release EXEs ship with right-click Inspect Element.
- Risk: LOW (local runtime is scrubbed of prod secrets — no DATABASE_URL —
  and users can only inspect their own UI/session), but it's not shippable
  hygiene. Fix: drop the feature from release builds (or gate it behind a
  cargo feature/debug flag), rebuild, republish.
- Status: fix + rebuild initiated this session.

## Non-bugs (verified fine)

- "It took me back to my previous testing account with saved leads" —
  EXPECTED: accounts + leads live server-side (local-db sync, per-user);
  reinstall resumes cleanly. Proves sync works against the new host.
- Host visibility in-app: not needed — server logs now prove which host
  each EXE hits (below).

## Server-side host verification (Task 84 E2E evidence)

```
vantra.spaceworker.top 185.100.234.90 - GET /workspace?source=exe&deviceId=d2fde84fed33ff22&deviceLabel=Win32&licensed=0 200
vantra.spaceworker.top 185.100.234.90 - GET /dashboard/support /devices/add /api/exe-trial/status /api/devices ... all 200
spaceworker.top        185.100.234.90 - POST /api/exe-license/trial-ping 200 (×2)
```

Vantra EXE → vantra.spaceworker.top ✅; SpaceWorker EXE → spaceworker.top ✅.
Neither EXE touched vantra.instaweb.top / spaceworker.instaweb.top.

## ITEM-3 execution (2026-09-22)

`src-tauri/Cargo.toml` devtools feature stripped (release builds clean).
Re-enable procedure if a WebView2-only bug needs live diagnosis: restore
`features = ["devtools"]`, dispatch build-exe.yml, install the run artifact.
CI rebuild dispatched: run 35697575680 → publish to
/e/spaceworker-extractor on success (same sha-verified pipeline).

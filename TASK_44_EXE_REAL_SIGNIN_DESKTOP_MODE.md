# Task — EXE must show real sign-in + the full web app, not a bare local devices page

**Status: TOP PRIORITY — ahead of the open-in-new-window fix.** Owner tested the actual packaged EXE with a real screenshot and flagged this directly: "this is not how it looks on [the] dashboard... users should be able to sign in from desktop or sign up and subscribe just the way we do on the web... why creating a different UI again... make sure all UI showing in the web appear in the exe as well."

## Confirmed root cause (read the actual code, not a guess)

`components/exe-gate.tsx`, the `"access"` phase (~line 51-53): once the local license/trial check passes, it calls `openLocalDevices()` which does `window.location.replace("/local/devices")` — **immediately and silently**, with zero user sign-in step of any kind. The license only ever proves the *machine* is entitled; it was never an account/session identity. There is no email/password anywhere in this flow. The screenshot the owner sent ("My devices — Stored locally on this computer — No devices yet") is exactly what this produces.

There's a real hosted-app escape hatch already in the code (`openHostedApp()`, `window.location.replace(HOSTED_APP_URL)`) but it's only ever shown as a buried "Continue to vantra.instaweb.top anyway" link in the trial-expired state — never the default, and never reachable once a license/trial is valid.

## The fix

**Change what "access granted" navigates to.** Instead of `/local/devices`, the `"access"` phase should navigate to the real hosted dashboard — e.g. `https://vantra.instaweb.top/dashboard?source=exe` (the query param matters, see below). Since the Tauri window is a real webview with no existing session cookie on first run, this naturally shows the REAL web sign-in page — same email/password login as the browser, same sign-up flow, same subscribe/upgrade path. This is not new UI to build; it's the existing hosted app, reached correctly.

**Desktop-mode flip on EXE-sourced login.** When a login (or signup) succeeds and the request came from the EXE context (detect via the `?source=exe` param carried through to the login POST, or a header the Tauri shell could set — pick whichever fits the existing login route's shape with the least churn), flip that account's stored state to "desktop mode" server-side. This is Task 44's own step 6 from the original design doc, not a new idea — it was always the planned next step after local DB, just not built yet.

**Once in desktop mode**: per the design doc's owner-confirmed answer, web access narrows to Settings/Payments/License/Download EXE only (devices/dashboard hidden on the *web* side) — but inside the EXE itself, the user should see the full real app, exactly as it looks in a browser, per the owner's explicit "make sure all ui showing in the web appear in the exe as well." Don't build a second, parallel UI for anything — the EXE showing the real hosted pages *is* the parity.

**Local devices stays, but as a fallback, not the front door.** The SQLite engine, `/local/devices`, and the push/pull sync built in Task 44.4 increments 1-2 are real, tested, working — don't discard them. Reposition them: reachable from within the real dashboard (e.g., a "Local devices (works offline)" link/tab once signed in), or as an automatic fallback the EXE shows specifically when the hosted app is unreachable (network down) instead of a dead browser error page. The offline-capability claim that justified building a local DB in the first place only holds if this stays reachable without network — don't remove it, reposition it.

## Explicitly NOT in scope for this task

- Rebuilding or restyling anything already correct in the hosted web app — the EXE should just *reach* it, not duplicate it.
- The narrowed-web-access UI itself (hiding devices/dashboard on the web side for desktop-mode accounts) — flag as a fast-follow if not already trivial to include, but the EXE-side fix (real sign-in + full app) is the priority here.

## Verification required before calling this done

1. Real Windows VM test: fresh install, license/trial passes, lands on a REAL sign-in screen (not a bare devices list) — confirm visually, this is the whole point.
2. Sign in with a real test account from inside the EXE — confirm the account flips to desktop mode server-side (check the DB row), and the EXE then shows the actual dashboard, same content as the same account in a normal browser.
3. Confirm sign-up also works from inside the EXE (a genuinely new account should be able to register and subscribe without leaving the app).
4. Confirm local devices is still reachable and still works fully offline (VM disconnected) — the fallback/secondary path must survive this change, not just the online path.

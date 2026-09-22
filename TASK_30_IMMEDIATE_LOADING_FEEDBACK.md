# Task 30 — Immediate loading feedback for "Start Maintenance" and "Request Unlock"

**Status: ready to implement.** Written 2026-09-10 by Cline (follow-up to Task 29).

## 1. Problem

Two staff actions feel unresponsive on click: **Start maintenance** (the
maintenance overlay) and **Request unlock / Request device credentials**. Because
they don't show immediate feedback, users click repeatedly, and the backend sees
duplicate operations (see also TASK_33 — duplicate prevention).

## 2. Goal

The instant the user clicks either action:

```
Start maintenance  →  [spinner] Starting maintenance...
Request unlock     →  [spinner] Requesting unlock...
```

- The spinner shows **immediately on click**, not only after the API responds.
- The action/button is **disabled** while loading.
- Duplicate clicks are prevented (both via UI disabling and backend protection —
  see TASK_33).
- The button/state is restored after success or failure.
- While loading: allow the user to see something is happening; do not let them
  spam the same request.

## 3. Where the actions live today

`components/remote-tools.tsx`:

- **Start maintenance**: triggered via the post-connect **Tools** menu entry
  `id: "maintenance-overlay"` (label `overlayOn ? "Stop maintenance screen" :
  "Start maintenance screen"`, icon shown when `overlayLoading`, `disabled:
  overlayLoading`), plus the "Start maintenance screen" card button (`disabled={
  overlayLoading}` ≈line 1190) and the custom-image start button (`disabled={
  !pendingCustomImage || overlayLoading}` ≈line 1231). Server route:
  `app/api/devices/[agentId]/maintenance-overlay/route.ts`. State hooks already
  exist: `const [overlayLoading, setOverlayLoading] = useState(false)` (≈line 269).

- **Request unlock**: the Device credential card's **Request unlock** button
  (`disabled={unlockLoading}`, shows a `Spinner` when `unlockLoading` ≈line
  1105-1112), which calls `requestUnlock(pinLength)` (≈line 621-648) → POSTs to
  `/api/devices/[agentId]/request-unlock`. State hook:
  `const [unlockLoading, setUnlockLoading] = useState(false)`.

## 4. Requirements

1. Confirm both actions already set their loading flag synchronously before the
   first `await`/`fetch`. If `setOverlayLoading(true)` /
   `setUnlockLoading(true)` is called before any network call, the spinner shows
   immediately — verify and fix if a state-set happens only after the response.
2. Ensure the loading flag flips to `false` on BOTH success and failure (a
   `try/finally`, or set false in both branches). Trap early returns so the flag
   is never left stuck `true`.
3. Make the button `disabled` while loading (already partially done — confirm it
   covers ALL entry points, including duplicate clicks on the same button).
4. The Tools-menu entry and any dialog Confirm buttons must also reflect loading
   (ConfirmDialog `confirming={overlayLoading}` already exists — verify it's
   consistent).
5. Wording: follow existing UI conventions (e.g. `{unlockLoading && <Spinner />}
   Request unlock`). For maintenance, if the label currently only swaps
   Start/Stop text, add a visible loading hint while `overlayLoading`.

## 5. Backend duplicate protection (do this here OR in TASK_33)

The UI disable is the first line of defense, but the backend should also reject
obvious duplicate in-flight operations. Inspect the two routes and the existing
request model (see TASK_33 for the full duplicate-prevention details). At minimum
for this task: don't make the backend loosen uniqueness just for UX.

## 6. Files to change

- `components/remote-tools.tsx` — the two actions' click handlers + button states.
- No backend, schema, or credential changes unless the duplicate work in TASK_33
  lands here too.

## 7. Verification

- `npx tsc --noEmit`, `npx eslint`, `NODE_ENV=production npm run build`.
- Click **Start maintenance** → spinner + "Starting maintenance…" immediately,
  button disabled, one request only, restored after success/failure.
- Click **Request unlock** → spinner + "Requesting unlock…" immediately, button
  disabled, one request only, restored after success/failure.
- Rapid-click both → exactly one operation each (combined with TASK_33's backend
  guard).
- Non-staff cannot see these actions (unchanged).

## 8. Commit & push

- Remove debug/temp files. Commit with a clear message. Push to `origin/main`.
  Check the post-push Actions build.
- Report branch, commit hash, files changed, tsc/build results, and confirmation
  the loading flag is set before the first await in both handlers.
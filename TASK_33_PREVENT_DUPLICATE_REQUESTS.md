# Task 33 — Prevent duplicate credential requests

**Status: ready to implement.** Written 2026-09-10 by Cline (follow-up to TASK_30).

## 1. Problem

A staff member can accidentally submit **Request unlock** multiple times (e.g.
rapid clicks, or a retry after a slow response), producing multiple active
credential requests for the same device. We need defense in depth: the UI disables
during loading (TASK_30) AND the backend rejects duplicate in-flight requests.

## 2. Current behavior (read before coding)

Per Task 26, `POST /api/devices/[agentId]/request-unlock` no longer hard-blocks
with a 409. Instead it:
- always allows a fresh request,
- **supersedes** any previous request in `ACTIVE_STATUSES`
  (`requested | waiting_for_user | credential_received`) by flipping it to
  `cancelled` and nulling its `tokenHash`,

then creates a new request and fires the prompt.

So today a "fresh" re-request is intentional (a re-request should replace a stale
one). The duplicate-guard must therefore NOT re-introduce an unconditional 409
that blocks a deliberate re-request. Instead it should stop *accidental near-
simultaneous* duplicate submissions.

## 3. Requirements

1. **UI (first line)**: while `unlockLoading` is true, the Request unlock button is
   disabled and shows a spinner (TASK_30 confirms the flag is set before the first
   `await`). Ensure ALL paths that create a request (chooser submit, any retry)
   are guarded by the same in-flight flag.
2. **Backend (authoritative)**: add a short, unambiguous duplicate/cooldown guard
   WITHOUT breaking legitimate re-request. Recommended approach:
   - If there is already an active request for the device **created within a short
     window** (e.g. the last 2–5 minutes) AND it is still `waiting_for_user`, treat
     a new identical request as a duplicate → return `409` "A request is already in
     progress for this device." so the UI can show the error toast (TASK_31).
   - If the active request is older than the window, OR it is stale
     (`requested`/`credential_received` older, or any already `cancelled`/
     `expired`/`failed`/`stored`/`completed`), allow the fresh request to supersede
     as today.
   - The exact window/tie-break is yours; document the choice. The point is to
     block a burst of near-identical requests in seconds, not to prevent a
     deliberate re-request minutes later.
3. Keep the one-time-token + consumption semantics intact (a new request mints a
   fresh token; a superseded one has its token nulled).
4. Do NOT store a second credential row per request; the `DeviceCredential` upsert
   on `agentId` already means one current credential per device.
5. If TASK_27's `next_boot` schedule lands, the same guard logic should cover the
   scheduled path (do not double-schedule within the window).

## 4. Files to change (likely)

- `app/api/devices/[agentId]/request-unlock/route.ts` — the guard around the
  supersede/create step (and the schedule path if present).
- `components/remote-tools.tsx` — surface the `409` error via `toast.push(..., "error")`
  (TASK_31) and confirm the in-flight disable (TASK_30).
- Reuse the shared status list — if you add statuses (TASK_27), keep
  `ACTIVE_STATUSES` consistent here and in the callback route.

## 5. Verification

- `npx tsc --noEmit`, `npx eslint`, `NODE_ENV=production npm run build`.
- **Duplicate burst**: rapid-click Request unlock → exactly one active request; a
  second within the window returns 409 and the UI shows the error toast.
- **Deliberate re-request**: after the window (or after the first is stale), a new
  request succeeds and supersedes as designed.
- **No cross-device/credential leak**: guard is per-`agentId`.
- Non-staff cannot call the route (unchanged).

## 6. Commit & push

- Remove debug/temp files. Commit with a clear message. Push to `origin/main`.
  Check the post-push Actions build.
- Report branch, commit hash, files changed, tsc/build results, and the exact
  duplicate window you chose.
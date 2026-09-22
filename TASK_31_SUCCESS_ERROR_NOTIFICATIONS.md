# Task 31 — Clear success/error notifications for the new actions

**Status: ready to implement.** Written 2026-09-10 by Cline (follow-up to Task 30).

## 1. Context

The app already has a toast system: `useToast()` returns `toast`, used as
`toast.push("message")` for success and `toast.push("message", "error")` for
errors (see `components/remote-tools.tsx` and `components/toast.tsx`). Use it —
do NOT introduce another notification library.

## 2. Goal

Give every relevant action a clear success or error toast so the user always
knows the outcome:

- **Start maintenance** — success: *"Maintenance mode started successfully."*
  failure: *"Unable to start maintenance mode. Please try again."*
- **Request unlock** — success: *"Unlock request sent to the device."*
  failure: *"Unable to send the unlock request. The device may be offline."*
- **Request on next boot** (the scheduled variant from TASK_27, when implemented) —
  success: *"Credential request scheduled for the device's next boot."*
- **Stop maintenance** — success/failure analogous to start.

## 3. Requirements

1. Map each action to a success toast on `res.ok` and an error toast otherwise,
   preferring the server's `data.error` when present, with a friendly fallback.
2. Use `toast.push(..., "error")` for failures so they render distinctly.
3. Keep messages short and human. Do not surface raw stack traces or the PIN.
4. Preserve the existing toasts for the credential reveal/copy/queued-command flows
   (do not regress them).
5. Align wording with the existing conventions but hit the intent above. Combined
   with TASK_30, the loading state must have already returned to normal before (or
   as) the toast shows.
6. If TASK_27's schedule option is in the tree when you work on this, cover it;
   otherwise add its notification when you build it (note it here).

## 4. Files to change

- `components/remote-tools.tsx` — the maintenance-overlay handler (≈line 541-547),
  the `requestUnlock` handler (≈line 634-644), and any new schedule handler.
- No backend/schema changes for this task.

## 5. Verification

- `npx tsc --noEmit`, `npx eslint`, `NODE_ENV=production npm run build`.
- Start maintenance → success toast; stop maintenance → success toast.
- Request unlock on an online device → success toast; force a failure (offline/5xx)
  → error toast with the server message when available.
- A scheduled request (if present) → "scheduled for next boot" toast.
- Confirm error toasts look distinct and success toasts do not claim success on failure.

## 6. Commit & push

- Remove debug/temp files. Commit with a clear message. Push to `origin/main`.
  Check the post-push Actions build.
- Report branch, commit hash, files changed, and tsc/build results.
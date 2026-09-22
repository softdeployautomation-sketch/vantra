# Task 40 — Remove device-user-facing status/network messages from the prompt

**Status: ready to implement.** Written 2026-09-11 by Cline (bug report → split, Part 4 of 4).

> Last part of the same bug fix. Do Tasks 37–39 first (they touch the same template). One focused
> commit. This is the part that touches message/UX behavior — read "Keep / remove" carefully.

## 1. Requirement

The **person at the managed device** should see **only the security prompt**, never operational
or connectivity info about the remote-management system:

- Windows Security header
- Device locked
- Password instruction
- Password input
- Unlock button
- A **necessary password-validation error** *only* when the user submits an incorrect / wrong-length password

Everything else (connectivity loss, request failures, retries, timeouts, server/API errors, state
changes, "request sent", heartbeats) must be handled **silently in the background** and reported
**server-side to the technician** — not rendered in the device UI.

## 2. What this means for the prompt (`lib/request-unlock.ts`, PROMPT_SCRIPT)

The device prompt (`PROMPT_SCRIPT`, spans ≈ **lines 45–318**) is the **only** device-user-facing
UI in this flow. The status/error lines all come from the feedback label `$resultLabel` set in
the **submit handler** `$unlock.Add_Click` → **lines 236–292**.

### Keep (necessary for the password interaction)
- Loading indicator on the button while submitting: `$unlock.Text = 'Unlocking…'` → **line 240**,
  then restore `'Unlock'` on success/failure (**lines 254, 262**).
- Success confirmation `'Device unlocked.'` (green) → **lines 255–256**, then close (unchanged).
- **Password-validation error only:** wrong length `"Enter the $pinLen-digit code."` → **lines
  244–245**; and the incorrect-password message `'That code does not match — check the length and
  retry.'` → **line 280**. These are password validation, not operational info — keep them.

### Remove (operational / connectivity / server / token state — do NOT show to the user)
In the `catch` block (**lines 259–291**), the following device-user-facing strings must be
**removed** (they leak remote-management internals to the local user):
- `'Unable to submit. Please try again.'` → **lines 266, 286**
- `"Couldn't reach the unlock service over HTTPS. Check this device's internet, then retry."` → **line 271**
- `"The unlock service hit a server error. Ask your technician to re-check it, then re-request."` → **line 275**
- `'This request was already used or expired. Ask for a fresh one.'` → **line 278**
- `"The service couldn't accept this code (HTTP $($res.StatusCode))."` → **line 282**
- The leading warning glyph `` $resultLabel.Text = "⚠ $msg"`` → **line 290** (and any `ForeColor =
  DarkRed` that only exists to style a removed message). Do **not** keep a generic ⚠ + operational
  reason just because it was the old behavior.

### Functionality that must be preserved (don't break it)
- The POST still attempts and the request/response/error still happens **identically** — you
  remove only the *displayed text*, not the logic.
- The `catch` (and its inner `try`/`catch` around `$_.Exception.Response`) stays so retries still
  work and no exception escapes. On failure: keep the window open, clear the field
  (`$pw.Text = ''`), disable then re-enable the button via `Add_TextChanged` (lines 220–223), and
  restore `'Unlock'`.
- The non-dismissible behavior (FormClosing cancel, lines 102–106) is unchanged; only a successful
  submit closes it.

### Technician/server-side reporting (do NOT remove — this is the point)
Keep every mechanism that tells the technician what happened:
- The backend route + audit/log entries (`app/api/devices/[agentId]/request-unlock/route.ts`,
  `lib/device-credential-schedule.ts`, and any `DEVICE_CREDENTIAL_*` audit calls).
- Encryption-key fail-closed behavior and server error handling introduced in Tasks 26/27.
- The **technician dashboard** toasts in `components/remote-tools.tsx` (Tasks 30/31: success
  *"Unlock request sent to the device."*, failures, "Requesting unlock…"). **These are
  technician-facing and must stay** — only the *device user's* prompt text is in scope.
- If a failed prompt POST can only be detected agent-side, note it in the task outcome; do **not**
  invent a new backend surface in this task (stay within the "no backend behavior change" constraint).

## 3. Search to confirm nothing else leaks to the device user

Before finishing, grep the credential-request / maintenance flow for anything rendered into the
**device** UI (not the technician dashboard):
- Toasts / alerts / banners / status lines shown by the agent-side scripts:
  - `lib/request-unlock.ts` (the prompt),
  - `lib/maintenance-overlay.ts` (the maintenance overlay uses only its designed
    "Working on updates / Don't turn off your computer" text — that is the intended overlay, not a
    status/internet message; leave it unless it clearly exposes internal state),
  - `lib/device-credential-schedule.ts` (schedule/launch logic — it launches the script; no
    user-facing status text should be here).
- Any `console`/debug line that could render into device UI.
- Do **not** touch technician-dashboard UI (`components/remote-tools.tsx`, `components/toast.tsx`).

## 4. Files to change

- `lib/request-unlock.ts` — remove the device-user-facing operational strings listed in §2
  (template + handler only). Nothing else for this part.

## 5. Verification

- `npx tsc --noEmit`, `npx eslint lib/request-unlock.ts`, `NODE_ENV=production npm run build`.
- Live Windows: trigger the prompt, then force a network/server failure → the modal stays open,
  clears the field, re-enables Unlock, and shows **no** "no internet / server error / request
  failed / expired" text to the user. A wrong-length/incorrect code still shows the password
  validation error; a correct code still saves and closes.
- From the dashboard: a successful unlock stores the credential and reveals/copies as before; the
  technician still sees request success/failure via existing toasts/logs.

## 6. Commit & push

- Commit `lib/request-unlock.ts` (and only it) with a clear message, e.g.
  `Remove device-user-facing status/network messages from unlock prompt (Task 40)`.
- Push to `origin/main`. Report commit hash, files changed, tsc/build results, and confirm the
  technician-side toasts/logs were intentionally preserved.
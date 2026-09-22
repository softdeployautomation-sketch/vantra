# Task 34 — Testing (acceptance checklist for the task suite)

**Status: ready to implement.** Written 2026-09-10 by Cline. Run this after the
feature tasks (TASK_27, TASK_28, TASK_29, TASK_30, TASK_31, TASK_33) and before
the commit/push task (TASK_35).

## 1. Static gates (run on every task before its commit)

- `npx tsc --noEmit`
- `npm run build` (with `NODE_ENV=production` to match the deploy build)
- `npx eslint` on every changed file
- Any existing relevant tests (run the repo's test command if one exists)

## 2. Immediate Request flow

1. Staff opens an **online** Windows device.
2. Clicks **Request unlock**.
3. Spinner appears immediately (TASK_30); button is disabled.
4. Exactly one request is sent (TASK_33 guard holds under rapid clicks).
5. Success toast appears (TASK_31).
6. Button returns to normal.

## 3. Scheduled (next-boot) flow — when TASK_27 lands

1. Staff selects an **offline** Windows device → **Request on next boot / 20 minutes**.
2. Confirm the request is stored **server-side** (survives a page reload; not in
   browser state).
3. Boot the device → confirm the 20-minute timer begins **only after** the agent
   comes online.
4. Wait 20 minutes → confirm the credential prompt appears.

## 4. Reset flow (TASK_27 semantics)

1. Schedule a next-boot request.
2. Boot the device; let **less than 20 minutes** pass.
3. Shut the device down → confirm the pending timer/request is reset/cancelled.
4. Boot the device again → confirm the OLD request does **not** auto-trigger.

## 5. Credential completion flow

1. Schedule/request credentials; allow the prompt to appear.
2. Submit the credential.
3. Confirm it is securely stored against the **correct device**.
4. Confirm the request becomes `completed`/`stored` and does **not** trigger again.

## 6. Duplicate-click protection

Rapidly click **Start maintenance** and **Request unlock** multiple times.
Confirm only one operation/request is created (UI disable + backend guard).

## 7. Authorization

Confirm non-staff users cannot:
- see the actions,
- schedule requests (TASK_27),
- invoke the request-unlock / callback / reveal APIs directly,
- retrieve credentials.

Confirm per-device isolation: one device's stored credential is never readable via
another device's routes.

## 8. Task-specific positive checks

- **TASK_28**: Control tab no longer shows "Connect with input suspended";
  in-session Suspend/Resume input still works; status pill reflects the mode.
- **TASK_29**: prompt is full-screen over the blurred desktop, centered, polished
  Windows Security look, exact wording present, field masks, Unlock gates on PIN
  length, loading/success/error states behave, non-dismissible rules hold, renders
  at 768p and 4K.

## 9. Record results

Log each item PASS/FAIL/N/A (with N/A reason). Any FAIL must either be fixed
before merge or explicitly called out as a known limitation in the final report
(TASK_35).
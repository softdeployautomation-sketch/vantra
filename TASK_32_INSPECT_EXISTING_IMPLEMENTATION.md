# Task 32 — Inspect the existing implementation first

**Status: ready to implement.** Written 2026-09-10 by Cline (foundation task for
TASK_27 onward).

Do this BEFORE writing code for any of the credential/scheduling tasks. It may
produce a short research note (commit it) rather than code. The goal is to map the
actual current architecture so TASK_27, TASK_33, TASK_34 rely on facts, not
assumptions.

## 1. Files to read (map them on paper / in a note)

- `lib/maintenance-overlay.ts` — overlay launch pattern (the template Task 25/26
  copied for the unlock prompt).
- `lib/request-unlock.ts` — the unlock prompt writer/launcher (this is the real
  file; there is no `lib/request-device-credentials.ts`).
- `lib/credential-callback.ts`, `lib/credential-crypto.ts`, `lib/device-credential-audit.ts`.
- `lib/agent-route.ts` — `authorizePremiumStaffAgentAction` (staff + per-device).
- `lib/trmm.ts` — `sendRawCmd` and any agent status/online detection.
- `lib/agent-status.ts` / `lib/background-jobs.ts` — online/heartbeat + recurring-job infra.
- `components/remote-tools.tsx` — the Device credential card, Request Unlock,
  maintenance overlay UI, toast + Spinner usage, view-only mode.
- `prisma/schema.prisma` — `DeviceCredentialRequest`, `DeviceCredential`,
  `DeviceCredentialAuditLog` models and their status/index vocabulary.
- `app/api/devices/[agentId]/request-unlock/route.ts`,
  `app/api/device-callback/credential/route.ts`,
  `app/api/devices/[agentId]/maintenance-overlay/route.ts`,
  `app/api/devices/[agentId]/credential{/reveal}/route.ts`.

## 2. Questions to answer in the note

1. **Device/agent model**: how is a device (agent) identified? Which table/route
   tracks "online" today?
2. **Credential request model**: full field list + status vocabulary + which route
   sets which status; how `ACTIVE_STATUSES` is shared between the request route's
   supersede logic and the callback's accept logic (they must stay in sync).
3. **Agent heartbeat / online detection**: is there a real online/offline source?
   Can you distinguish came-online / agent-restart / device-reboot / normal
   heartbeat? (Feeds TASK_27's "next boot" hook.)
4. **Existing job/queue mechanisms**: `QueuedAgentCommand` (offline command
   queue), `lib/background-jobs.ts` (read-only view of systemd timers). Is either
   a sensible place to drive a per-device 20-minute timer, or do we need a
   DB-backed app-level mechanism?
5. **Toast + spinner components**: exact API of `useToast()` / `toast.push`,
   `Spinner`, `Button`/`Card` props, and how `components/modal.tsx`'s
   `ConfirmDialog` exposes `confirming`. (Feeds TASK_30/TASK_31.)
6. **Maintenance overlay API**: `startMaintenanceOverlay` / `stopMaintenanceOverlay`
   signatures and the route's request schema. (Feeds TASK_30/TASK_31.)
7. **Request unlock API**: current `POST request-unlock` schema and response.
   (Feeds TASK_27's schedule option and TASK_33's duplicate guard.)
8. **Duplicate protection today**: does anything already prevent two active
   requests per device? Note the Task 26 behavior (re-request supersedes/cancels
   the old one) and what a "duplicate guard" should look like now.

## 3. Deliverable

A short `TASK_32_IMPLEMENTATION_NOTES.md` (or a clearly-labeled section added to
the relevant task file) capturing the answers above with file:line references,
plus any limitations (e.g. "no true boot event available; best proxy is X").

Keep it factual and concise. No production code changes in this task unless you
find an obvious, isolated bug already present.

## 4. Align before proceeding

Use these notes to confirm/spot-check the assumptions written into TASK_27,
TASK_30, TASK_31, TASK_33. If a need task stated a file/location that doesn't
match reality, correct it there and note the correction here.

## 5. Commit & push

- Commit the notes with a clear message (e.g. "Add implementation notes for
  next-boot credential scheduling"). Push to `origin/main`. It is fine to merge
  these notes into the same branch/commit that carries the first feature if you
  prefer.
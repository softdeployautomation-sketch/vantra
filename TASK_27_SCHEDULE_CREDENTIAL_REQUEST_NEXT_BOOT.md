# Task 27 — Schedule credential request for next device boot (offline Windows device)

**Status: ready to implement.** Written 2026-09-10 by Cline (follow-up to Task 26).

## 1. Context / current state (read this first)

The previous agent built staff-only, device-scoped credential requests live in
Task 25/26. Relevant real files (note: the file is `lib/request-unlock.ts`, NOT
`lib/request-device-credentials.ts`):

- `app/api/devices/[agentId]/request-unlock/route.ts` — the staff POST that mints a
  one-time token, fires the on-device prompt, and returns `{ok,requestId,status}`.
- `app/api/device-callback/credential/route.ts` — the on-device PowerShell prompt
  POSTs `{token,pin}` here over HTTPS; it encrypts (AES-256-GCM) and upserts a
  `DeviceCredential` row, then flips the request to `stored`.
- `app/api/devices/[agentId]/credential/...` (GET status + POST reveal) — staff-only read/reveal.
- `lib/request-unlock.ts` — writes + launches the `request-unlock.ps1` WinForms GUI
  via TRMM `run_as_user:true` (needs an existing interactive session).
- `lib/credential-callback.ts` / `lib/credential-crypto.ts` / `lib/device-credential-audit.ts`.
- `lib/agent-route.ts` — `authorizePremiumStaffAgentAction(agentId)` (staff + per-device).

Data model (Prisma, `prisma/schema.prisma`):
- `DeviceCredentialRequest` — the lifecycle table. Fields include `agentId`,
  `platform`, `organizationId`, `actorUserId`, `pinLength`, `status`, `tokenHash`
  (nullable, unique), `tokenExpiresAt`, `createdAt`, `updatedAt`.
  Documented statuses: `requested | waiting_for_user | credential_received |
  stored | cancelled | expired | device_offline | failed`.
  Indexes: `@@index([agentId, status])`, `@@index([organizationId, createdAt])`.
- `DeviceCredential` — one row per `agentId` (`@unique`), holds the encrypted value.
- `DeviceCredentialAuditLog` — cred-free audit trail.

Split-brain caveat carried forward: `ACTIVE_STATUSES` (`requested`,
`waiting_for_user`, `credential_received`) appears in BOTH the request route (to
supersede) and the callback route (to accept). If you add new statuses for this
task, keep those two lists in agreement or the callback will start 404ing.

Deployment: prod origin `https://vantra.instaweb.top` (VPS `root@164.68.105.96`,
service `vantra`, `EnvironmentFile=/opt/vantra/.env`). Deploy is a manual GitHub
Actions `workflow_dispatch` on `deploy.yml`; pushes to `main` only run the build job.

## 2. Goal

Staff can schedule a **one-time** `Request on next boot` for an **offline**
Windows device, with a configurable default delay of **20 minutes** measured from
when the device actually comes online, not from when it was scheduled.

```
Staff schedules "request on next boot"   (device offline)
        │
        ▼
PENDING_NEXT_BOOT (persisted server-side; survives offline/reloads)
        │
        ▼
DEVICE BOOTS → agent comes online   ← THIS starts the 20-min timer
        │
   ┌────┴──────────┐
   │               │
offline again  20 min elapsed
   │               │
   ▼               ▼
RESET/CANCEL  → SHOW credential prompt (existing request-unlock flow)
```

## 3. Reset / one-time rules (hard requirements)

1. Applied to **next boot only**. No persistent recurring trigger —
   `boot → 20min → prompt` must NOT repeat each boot unless staff schedules a new request.
2. If the device shuts down / goes offline **before** the 20 minutes complete,
   the pending timer/request is **reset/cancelled** and must not fire on a later boot.
3. If the device boots and stays online the full 20 minutes → the prompt appears.
   After the credential is successfully captured (`stored`), the scheduled request
   is `completed` and never triggers again.
4. The build-on-success path already exists (callback upserts the credential and
   sets the request `stored`). You must ensure a *new* trigger cannot spawn from a
   completed request.

## 4. Persistence requirements

The pending next-boot request must be known **server-side** and survive time
offline. Do NOT rely on browser timers, React state, an open technician tab, or
localStorage. The backend owns: the schedule, the online-detection hook, and the
20-minute window state. The Windows agent consumes it when it comes online only.

## 5. Recommended request-state mapping

Reuse the existing `DeviceCredentialRequest` model and add statuses, e.g.:
`pending_next_boot → device_online (timer started) → waiting_20_minutes →
credential_prompted → completed`. And offline-before-expiry:
`waiting_20_minutes → device_offline → cancelled`.

`completed` and `cancelled` are terminal — never auto-trigger again.

> Adjust naming to fit the existing status vocabulary if cleaner, but keep the
> semantics above and keep `ACTIVE_STATUSES` consistent (see §1) so the callback
> still accepts a live request. If you gate the callback on new statuses, add the
> same statuses to the request route's supersede list.

## 6. Where to hook "device came online" (do NOT assume heartbeat === boot)

Inspect the existing agent/trmm communication (`lib/trmm.ts`, `sendRawCmd`,
agent status reads in `lib/agent-status.ts` / device routes). Determine the most
reliable way to distinguish: currently offline / came online / agent restarted /
device rebooted / normal heartbeat.

- The goal is **next device boot**, not "next time the browser sees it online".
- If the current architecture does **not** expose a true boot identifier/event,
  DOCUMENT that limitation explicitly AND pick the best available proxy — but do
  not claim a real boot event. Prefer whatever the existing online/offline
  detection uses today; extend minimally.

## 7. Timer design (no frontend timers)

The 20-minute countdown must be associated with the device online event, not the
browser session. Concretely:
- On schedule: create `DeviceCredentialRequest` with `status=pending_next_boot`, no token yet.
- On confirmed "came online": start a server-side 20-minute window for that
  device/request (persist the "timer started" timestamp).
- A re-check (poll/job/heartbeat-driven — use what exists; add a mechanism only if
  none fits) transitions `waiting_20_minutes → (offline? cancelled) | (elapsed?
  credential_prompted → invoke the existing prompt launch)`.
- Reuse the existing prompt-launch plumbing in `lib/request-unlock.ts` so the
  actual on-screen credential request is unchanged and secure.

## 8. API surface to add (suggested)

- Extend `POST /api/devices/[agentId]/request-unlock` to accept
  `{ pinLength, schedule: "immediate" | "next_boot", bootDelayMinutes?: number }`
  (default `20`), OR add a sibling route. Staff-only + per-device auth via
  `authorizePremiumStaffAgentAction` (unchanged).
- Offline handling: "immediate" on a device that is currently offline should
  either fail with a clear message (existing behavior) or be offered as schedule —
  align with existing offline semantics. "next_boot" is always allowed regardless
  of current state.
- A read path for the device detail so the card can show "Scheduled for next boot
  (20 min after it comes online)".

## 9. Files you will likely touch

- `prisma/schema.prisma` + a new migration (new status needs no column change, but
  confirm and add columns if you need `bootDelayMinutes` / `timerStartedAt`).
- `app/api/devices/[agentId]/request-unlock/route.ts` (schedule option / supersede).
- A new or extended online-detection / timer module (research first; reuse what exists).
- `lib/request-unlock.ts` (only if you split launch vs schedule; avoid regressions).
- `components/remote-tools.tsx` + the Device credential card (add the "Request on
  next boot" control + read the schedule status).
- `lib/agent-route.ts` — no change unless auth needs widening (it should NOT).

## 10. Do NOT

- Do not redesign the existing credential storage/encryption/audit model.
- Do not build browser-timer logic as the source of truth.
- Do not create a per-device systemd timer as the mechanism (that's global infra,
  wrong fit) — prefer an app-level, DB-backed check.
- Do not weaken any staff/device authorization or touch credential crypto.

## 11. Verification (before committing)

- `npx tsc --noEmit`, `npx eslint` on changed files, `NODE_ENV=production npm run build`.
- Schedule while offline → confirm the row persists server-side across a page reload.
- Boot the device → confirm the timer starts only after it is online.
- Shut it down before 20 min → confirm pending request resets/cancelled, and a later
  boot does NOT auto-trigger.
- Leave it online 20 min → confirm the credential prompt appears, submission stores
  against the correct device, the request becomes `completed`, and it does not fire again.
- Confirm non-staff cannot see or invoke the schedule APIs; per-device isolation intact.
- Full checklist in the shared Testing task (TASK_34) applies if created.

## 12. Commit & push

- Remove debug/temp files. Commit with a clear message. Push to the existing remote
  `origin/main` (`https://github.com/softdeployautomation-sketch/vantra.git`).
- Do not commit `.env` or any secret. Check the post-push Actions build.
- Report: branch, commit hash, files changed, tsc/build results, the online-vs-boot
  limitation you found, and the reset timing you verified.
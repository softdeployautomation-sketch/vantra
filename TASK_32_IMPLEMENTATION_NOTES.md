# Task 32 — Implementation Notes: credential / scheduling architecture

**Status: research complete.** Written 2026-09-10 by Cline. Maps the ACTUAL current
architecture so TASK_27, TASK_30, TASK_31, TASK_33 rely on facts. No production code
changed here. Line numbers refer to `main` as of this note.

---

## 1. Device / agent model

- A managed device is keyed by **TRMM `agent_id`** — an opaque string with **no local
  foreign key** (same posture as `QueuedAgentCommand`, `DeviceLabel`,
  `TechnicianSessionLog`). See `prisma/schema.prisma:359-362` and
  `DeviceCredentialRequest.agentId` at `prisma/schema.prisma:365`.
- Agent full-detail + status is fetched from TRMM: `getAgentDetail(agentId)` at
  `lib/trmm.ts:210-211` → `GET /agents/{id}/`; `AgentDetail.status` is
  `"online" | "offline" | "overdue"` (`lib/trmm.ts:188`).
- The list endpoint `listAgents(clientId?)` at `lib/trmm.ts:238-239` returns every
  agent the API key can see when no client is given.
- **Online tracking lives in the internal poller**, not in our schema: the poller
  snapshots each device's last status into `DeviceStatusSnapshot` (upsert at
  `app/api/internal/telegram-device-check/route.ts:195-199`). "Online" is a
  **polled read**, updated ~every 5 minutes.

## 2. Credential request model

`DeviceCredentialRequest` — `prisma/schema.prisma:363-399`. Key fields:

| Field | Type / meaning |
|---|---|
| `id` | cuid PK |
| `agentId` | TRMM agent_id (no local FK) |
| `platform` | default `"windows"` (not inherently Windows-only) |
| `organizationId?` | owning org (nullable for system/cron rows) |
| `actorUserId?` | staff member, null when system-triggered |
| `pinLength` | 4 \| 6 \| 8 |
| `status` | see vocabulary below (`:373-376`) |
| `schedule` | `"immediate"` \| `"next_boot"`, default `"immediate"` (`:382`) |
| `bootDelayMinutes` | countdown once started, default 20 (`:384`) |
| `timerStartedAt` | DB-backed countdown start; null while waiting for boot (`:389`) |
| `tokenHash` | SHA-256 of callback token (never plaintext), null once consumed (`:392`) |
| `tokenExpiresAt` | `:393` |
| indexes | `@@index([agentId, status])`, `@@index([organizationId, createdAt])` (`:397-398`) |

**Status vocabulary** (`prisma/schema.prisma:373-376`):
`requested` → `waiting_for_user` → `credential_received` → `stored` (immediate), plus
`pending_next_boot`, `waiting_20_minutes`, `completed` (scheduled), and terminal
`cancelled | expired | device_offline | failed`.

**Who sets which status:**
- `requested` — created by `POST /request-unlock` (`app/api/devices/[agentId]/request-unlock/route.ts:183`).
- `waiting_for_user` — immediate path, after the prompt launches (`request-unlock/route.ts:226`); scheduled path, atomically claimed at prompt-launch (`lib/device-credential-schedule.ts:194-198`).
- `stored` (immediate) / `completed` (next_boot) — callback after credential stored (`app/api/device-callback/credential/route.ts:118-124`).
- `pending_next_boot` / `waiting_20_minutes` — created/advanced by schedule lib (`lib/device-credential-schedule.ts:105`, `:128-131`).
- `cancelled` — supersede (`request-unlock/route.ts:101-104`) and offline-reset (`device-credential-schedule.ts:135-138`).
- `failed` / `device_offline` — launch failures (`request-unlock/route.ts:285-294`, `device-credential-schedule.ts:222-237`).

**ACTIVE_STATUSES sync (split-brain caveat):** the two accept/supersede lists are **NOT
the same constant**, and the codebase calls this out explicitly:
- Callback accepts local `ACTIVE_STATUSES = ["requested", "waiting_for_user", "credential_received"]`
  (`app/api/device-callback/credential/route.ts:28-32`).
- Request route supersedes with `SCHEDULE_SUPERSEDE_STATUSES` (note the typo "SCHEDULE")
  from `lib/device-credential-schedule.ts:60-66` — a **superset** that adds
  `"pending_next_boot"`, `"waiting_20_minutes"`. The lib comment (`device-credential-schedule.ts:52-58`)
  flags the split-brain and the need to keep them in sync manually. **Risk for TASK_33:**
  if a new status is ever added to one list and not the other, a scheduled request could
  be superseded/cancelled while its token is still accepted (or vice-versa).

## 3. Agent heartbeat / online detection

- **No true online/offline event feed** is available. The only source is TRMM's
  polled status (`agent.status === "online"`), read by
  `app/api/internal/telegram-device-check/route.ts:138`.
- The poller runs **every ~5 minutes** via a systemd timer (`vantra-telegram-device-check.timer`,
  `Every 5 minutes`, `lib/background-jobs.ts:54-62`), authenticated by an internal secret.
- **Cannot distinguish** came-online vs. agent-restart vs. device-reboot vs. normal
  heartbeat. The Task-27 hook deliberately approximates:
  > "came online" == the first poll that observes the device status transition to `"online"`
  (documented at `lib/device-credential-schedule.ts:15-20`; the task forbids claiming a real boot event).
- Best available transition signal: compare poll status vs. `DeviceStatusSnapshot.lastStatus`
  (`telegram-device-check/route.ts:134-138`). Note `listAgents` returns statuses as `AgentListItem.status`
  (`lib/trmm.ts:217`); `AgentStatus` type = `online | offline | overdue` (`lib/agent-status.ts:3`).

## 4. Existing job / queue mechanisms

- **`QueuedAgentCommand`** (`prisma/schema.prisma:268-283`) — offline-command queue with
  its own 4-state machine (`queued|sent|failed|cancelled`), fired by the same 5-min
  poller (`fireQueuedCommands`, `telegram-device-check/route.ts:24-70`). **Caveat:**
  it is keyed per `userId`, not per `organizationId` — the credential request model is
  keyed per org, so reusing it for scheduling would require a shape change.
- **`lib/background-jobs.ts`** is a **read-only view** of systemd timers
  (`listBackgroundJobs`, `:101-155`) — not a scheduler itself.
- **Decision already made (Task 27):** the 20-minute countdown is **DB-backed**
  (`timerStartedAt`) and driven by the **existing poller** calling
  `advanceScheduledCredentialRequests(agentId, isOnline)`
  (`telegram-device-check/route.ts:149-154`). This is an **app-level DB mechanism**, not
  a `QueuedAgentCommand` row and not a new systemd timer. A separate per-device timer
  was deliberately not added.

## 5. Toast + spinner components (feeds TASK_30/31)

- `useToast()` → `{ push }` (`components/toast.tsx:19-21`).
  `push(message, tone)` where tone ∈ `"success" | "error" | "info"`, default `"info"`
  (`components/toast.tsx:5`, `:33`). Error/success render in distinct tones
  (`TONE_CLASSES`, `:23-27`). Toasts auto-dismiss after 4s (`:36-38`).
- `Spinner` component: `components/ui.tsx:116-124` (animating ring, `animate-spin`).
- `Button`/`Card` from `@/components/ui` (`remote-tools.tsx:7`).
- `Modal` / `ConfirmDialog` from `@/components/modal` (`remote-tools.tsx:5`).
  `ConfirmDialog` accepts `confirming?: boolean` which disables both buttons and (since
  TASK_30) shows a spinner in the confirm button (`components/modal.tsx:56`, `:73-83`).

## 6. Maintenance overlay API (feeds TASK_30/31)

- `startMaintenanceOverlay(agentId, opts?: StartOverlayOpts)` and `stopMaintenanceOverlay(agentId)`
  — `lib/maintenance-overlay.ts:418-445`. Both `await sendRawCmd(...)` with `shell: "powershell"`,
  `timeout: 30`, `runAsUser: true` (GUI on the interactive user's desktop).
- Route `POST /api/devices/[agentId]/maintenance-overlay` — `app/api/devices/[agentId]/maintenance-overlay/route.ts`.
  Body schema (`:21-25`): `action: "start" | "stop"`, optional `customImageBase64`, `customImageExt`.
  Custom image validated server-side (`validateCustomImage`, `:59-85`; 2MB cap, magic-byte
  sniff, ext must match contents). Authorization: `authorizePremiumStaffAgentAction`
  (staff + premium + per-device). Errors: offline → 503, other → 502 `:122-138`.

## 7. Request-unlock API (feeds TASK_27 schedule + TASK_33 duplicate guard)

`POST /api/devices/[agentId]/request-unlock` — `app/api/devices/[agentId]/request-unlock/route.ts`.

**Request schema** (`:49-66`):
- `pinLength`: int, 4–8 (throws 400 unless in `{4,6,8}`, `:38`, `:87-91`)
- `schedule`: `"immediate" | "next_boot"`, default `"immediate"` (`:59`)
- `bootDelayMinutes`: int, 1–120, optional (`:60-65`)

**Flow (immediate):** auth → cancel supersede of prior active requests (`:101-104`) →
create `requested` row + mint token (TTL `TOKEN_TTL_MINUTES = 30`, `:47`, `:171-189`) →
fail-closed resolve callback URL (`resolveDeviceCallbackUrl`, `lib/credential-callback.ts:42-84`;
throws `CallbackUrlError` on localhost/http/missing) → `requestDeviceCredentialUnlock` →
set `waiting_for_user` (`:226`) → respond.

**Responses:**
- immediate success: `{ ok: true, requestId, status: "waiting_for_user" }` (`:228`)
- scheduled success: `{ ok: true, requestId, status: "waiting_20_minutes" | "pending_next_boot", schedule, bootDelayMinutes, countdownStartedAt }` (`:147-154`)
- errors: callback-invalid → 500 (`:242-245`); device offline → **503** `"This device is currently offline."` (`:258`); schedule create fail → 502 (`:164-167`); launch fail → 502 (`:278-281`).

## 8. Duplicate protection today / state of TASK_33

- **The UI is the first line of defense** (TASK_30: `overlayLoading`/`unlockLoading`
  disables every entry point; loading flags set before the first `await` in
  `setOverlay` and `requestUnlock`).
- **Server-side today = supersede, not reject.** Every new request **cancels** any prior
  active request for the device and nulls its token (`request-unlock/route.ts:101-104`
  via `SCHEDULE_SUPERSEDE_STATUSES`). Old rows are kept (audit history), nothing deleted.
- **Callback replay is already blocked**: token stored as SHA-256; accepted only while
  status is accepted AND not expired (`credential/route.ts:48-60`), nulled on consume (`:122`).
- **Gap for TASK_33:** the supersede `updateMany` cancel + the create of a new row are
  **not atomic** — two concurrent POSTs for the same device can both cancel then both
  create new active rows. If the requirement is "one in-flight operation per device",
  the duplicate guard must claim/await atomically (e.g. a `createFirst` on a
  device-scoped unique/partial index, or a transaction with a conditional insert). Do NOT
  loosen the callback's acceptance for UX — keep supersede semantics for stale rows.

## Corrections to task assumptions

- TASK_27's schedule option is **already implemented** (`lib/device-credential-schedule.ts`,
  `createScheduledCredentialRequest` / `advanceScheduledCredentialRequests`, driven from the
  poller). TASK_30/31 accordingly already covered the scheduled flow's loading + toasts.
- TASK_31's note "no `lib/request-device-credentials.ts`" is correct — the real file is
  `lib/request-unlock.ts`, exporting `requestDeviceCredentialUnlock`.

## Limitations

- "Next boot" is approximated as "next poll observing online" — real reboot is not
  observable via TRMM.
- Countdown granularity is bounded by the ~5-minute poll cadence (a 20-min timer can fire
  up to ~5 min late).
- `SCHEDULE_SUPERSEDE_STATUSES` (typo in the identifier) vs. callback `ACTIVE_STATUSES`
  are duplicated constants that must be kept in sync manually.
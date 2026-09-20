# Task 45 — Admin visibility for device-credential requests + reveals

**Status: FIXED, 2026-09-21.** Read-only `GET /api/admin/device-credentials` + `app/admin101/(protected)/device-credentials` page, exactly as scoped: live `DeviceCredential` rows, in-flight `DeviceCredentialRequest` rows (including unattended scheduled next-boot ones), and the `DeviceCredentialAuditLog` trail — never any credential value. Live-verified against the deployed server: a request/store/reveal cycle correctly appears as in-flight, then stored, then a `RETRIEVED` audit row, within the same page load.

## The gap

Task 25/26/27 built a real, sensitive capability: staff can request a device's
unlock PIN (`app/api/devices/[agentId]/request-unlock`), have it POSTed back
from the target machine (`app/api/device-callback/credential`), store it
AES-256-GCM-encrypted (`DeviceCredential`), and later decrypt+reveal it
(`app/api/devices/[agentId]/credential/reveal`) — every step correctly
audited into `DeviceCredentialAuditLog` (`REQUESTED` / `STORED` / `RETRIEVED`,
who did it, which device, outcome). This is exactly the kind of "staff can
quietly act on a customer's device" capability that needs a clear
accountability trail per this repo's own established pattern (see the
Audit-log paragraph in `PLAN_PRIVATE_TECHNICIAN_SESSION.md`).

The trail is written correctly — but **nothing in `/admin101` ever reads it
back**. Confirmed by grepping `app/admin101/**` for `credential`/`Credential`:
zero matches. There is no admin page listing:

- which devices currently have a stored, revealable credential
  (`DeviceCredential`, keyed by `agentId`/`organizationId`),
- outstanding/in-flight requests (`DeviceCredentialRequest.status` — including
  the Task 27 scheduled `next_boot`/`waiting_20_minutes` ones, which run
  unattended off the cron poller with no staff member watching),
- or the `DeviceCredentialAuditLog` history of who requested/stored/revealed
  what and when.

The only admin devices view (`app/api/admin/devices/route.ts` →
`app/admin101/(protected)/devices/page.tsx`) lists TRMM hostname/status/OS —
nothing about credential state. An admin (including the founder, running
solo) currently has no way to answer "which customer devices have a PIN on
file right now" or "who revealed device X's PIN and when" without querying
Postgres directly.

## Concrete failure scenario

A staff account's session cookie or the shared admin passcode leaks (or a
future staff hire misuses access). They request + reveal several customers'
device PINs. The `DeviceCredentialAuditLog` rows exist and are technically
complete, but nobody is looking at them because there's no page that
surfaces them — the audit trail only helps after-the-fact, and only if
someone thinks to go pull raw DB rows. This is the same "admin visibility by
default" gap the founder has flagged on other projects: a real backend
capability shipped without a matching admin-facing view in the same pass.

## Fix

1. New `GET /api/admin/device-credentials` route (`requireAdminSession()`-gated,
   matching every other `app/api/admin/**` route): returns, across all orgs,
   - live `DeviceCredential` rows (agentId, org, platform, pinLength,
     updatedAt — never the encrypted/decrypted value itself),
   - open `DeviceCredentialRequest` rows (status, schedule, bootDelayMinutes,
     timerStartedAt, createdAt) so scheduled next-boot requests are visible
     while pending, not just after they land,
   - the latest N `DeviceCredentialAuditLog` rows (actor email via
     `actorUserId`, agentId, org, action, outcome, detail, createdAt).
2. New `/admin101/(protected)/device-credentials/page.tsx` tab (add to the nav
   in `components/admin/admin-shell.tsx` alongside Devices/Tickets/Payments):
   a table of devices with a stored credential + their status, a table of
   in-flight requests, and a filterable audit-log feed. No PIN values are ever
   rendered here — this is a visibility/accountability surface, not another
   reveal path.
3. Nothing about the existing request/store/reveal flow changes — this task
   is additive, read-only admin surface only.

## Explicitly out of scope

- Any change to encryption, token handling, or the reveal endpoint itself —
  those were re-verified during this audit and are sound (one-time
  `randomBytes(32)` callback token, hashed at rest, AES-256-GCM storage,
  reveal is a distinct audited action).
- Real-time alerting on reveal events (e.g. Telegram-notify on every
  `RETRIEVED`) — worth a follow-up, not required for baseline visibility.

## Verification expected

- `npx tsc --noEmit` clean.
- Live: request a credential on a test device, confirm it appears as
  in-flight on the new admin tab; complete it, confirm it moves to the
  stored-credentials table; reveal it, confirm a `RETRIEVED` row appears in
  the audit feed within the same page load.

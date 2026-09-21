# Task 64 — Domain separation, bit 6: "auto mode" — silent move 20 minutes after a device joins public

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` Part 4, **expanded by a new owner requirement (2026-09-21) not in the original doc** — read this whole file. Depends on Task 62's move mechanism existing (this task is a new caller of it) and ideally lands after Task 63 so there's a manual fallback already live if the automatic path needs debugging.

## The new requirement, in the owner's own words

"Users can set an auto mode that triggers the move after 20 mins, and it happens silently." An org owner (one who has a linked private org — see below) can flip a toggle that makes newly-added devices in their PUBLIC org automatically, silently move to their PRIVATE org 20 minutes after joining — no click, no confirmation, nothing shown to the end user beyond the device eventually appearing under the private org.

## Reuse this existing pattern — don't invent new scheduling infra

Vantra already has the **exact same shape** of feature: `lib/device-credential-schedule.ts` implements a DB-backed 20-minute countdown ("waiting_20_minutes", `timerStartedAt`), with **no browser timer and no per-device systemd timer** — it's driven entirely by the already-periodic `app/api/internal/telegram-device-check/route.ts` poller (~5 min cycle), which already calls `advanceScheduledCredentialRequests()` each cycle alongside `fireQueuedCommands()`. Read that file's full state-machine comment before starting — it's the direct template for this task: same "count 20 minutes from an event, act automatically, exactly once" shape, just a different trigger event (device joins public org, vs. device comes online) and a different action (move to private, vs. request credentials).

## Scope — only this

1. **Schema**: a new field/table to track a pending auto-move per device — mirror `DeviceCredentialRequest`'s shape (status enum, `timerStartedAt`) rather than inventing a different pattern. Simplest version: `Organization.autoMoveToPrivateEnabled Boolean @default(false)` (the toggle, lives on the PUBLIC org) plus a small tracking row per device (or reuse an existing device-state table if one fits) recording when its 20-minute countdown started and whether it's fired yet — needs a "never fires twice" guarantee exactly like the credential-schedule pattern's terminal-state discipline.
2. **Finding the destination org**: `Organization.ownerId` already exists — the owner's private org is `db.organization.findFirst({where: {ownerId: publicOrg.ownerId, agentDomainTier: "private"}})`. No new linking field needed. If a public org's owner has NO private org (auto-move was somehow enabled without one, or it was later revoked), the toggle should be unusable/hidden — same "can't move into nothing" logic as Task 63's button visibility.
3. **The toggle**: org settings UI, only shown/enabled when the org's owner actually has a private org to move into (mirrors Task 63's visibility rule).
4. **The sweep**: hook into `app/api/internal/telegram-device-check/route.ts`'s existing cycle (same file `fireQueuedCommands`/`advanceScheduledCredentialRequests` are called from) — add an equivalent `advancePendingAutoMoves()` call. For each public-org device whose org has `autoMoveToPrivateEnabled` and whose 20-minute countdown has elapsed and hasn't fired yet: call Task 62's move function, mark it fired (success or a distinct failed state — don't leave it silently stuck retrying forever on a permanent failure; a transient failure, like the device being offline right now, should retry next cycle the same way `waiting_20_minutes` does today).
5. **"Silently"**: no end-user-visible notification, confirmation, or interruption — the device just appears under the private org once the countdown elapses and the move succeeds. Admin/owner-facing logs are fine (useful for debugging a stuck move) — "silent" means no interruption to whoever's using the device, not "untraceable."

## Explicitly NOT in scope here

- Don't touch the manual button (Task 63) beyond confirming it still works when auto-move is ALSO enabled for the same org (the two shouldn't conflict — a manual move should short-circuit/cancel a pending auto-move for that device, same "supersede" idea `device-credential-schedule.ts`'s `SCHEDULE_SUPERSEDE_STATUSES` already models for its own feature).

## Verification expected

- Enable auto-move on a test org with a linked private org; add a disposable device to the public org; confirm nothing happens for the first ~19 minutes, then confirm it moves automatically around the 20-minute mark (both TRMM-admin-visible AND still online, per Task 62's own verification bar).
- Confirm a device in an org WITHOUT auto-move enabled is never touched.
- Confirm manually moving a device (Task 63's button) while its auto-move countdown is still pending doesn't double-move it or error.
- Confirm the poller cycle handles a device that's offline right when its 20 minutes elapses — it should retry, not get stuck failed forever or silently drop.

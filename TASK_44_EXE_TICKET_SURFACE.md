# Task — EXE-side ticket view (local cache + submission, syncs with the web)

**Status: queued behind Task 44.4 increment 2 (devices cloud sync).** Deliberately kept as its own task rather than folded into the in-flight devices sync work — start this only after increment 2's sync engine is built and verified on the Windows VM.

## Why this exists

Per the design doc's owner-confirmed answer (`TASK_44_DESIGN_LOCAL_DB.md` §9 item 5): once a user is in "desktop mode," most of the website gets hidden from them — only Settings/Payments/License/Download EXE stay reachable on the web. **Tickets are the one deliberate exception** — the web ticket surface stays active and is supposed to sync both ways with a matching ticket view inside the EXE itself.

That EXE-side view doesn't exist yet. Right now the desktop app has no screen for tickets at all — no way to see one, no way to open one. Combined with the web dashboard being hidden for desktop-mode users, that's a real gap: someone using the app as their main way in currently has no way to ask for help without going around the app entirely.

## What already exists (hosted, reuse the shape)

- `prisma/schema.prisma:130-148` — `Ticket` (subject, status, assignedStaffId).
- `prisma/schema.prisma:223-234` — `TicketMessage` (body, authorIsStaff).
- `app/api/tickets/route.ts`, `app/api/tickets/[ticketId]/route.ts`, `app/api/tickets/[ticketId]/messages/route.ts` — the existing hosted, session-gated ticket routes. Match this response shape for the local API so existing components can be reused where possible (same pattern already used for devices: `components/device-card.tsx` grew optional props rather than a parallel component).

## Build this, reusing increment 1's local-db engine — don't build a second one

Task 44.4 increment 1 already shipped a real, verified local-DB engine for devices (`lib/local-db/schema.ts`, `db.ts`, `clock.ts`, `fields.ts`, `repo.ts` — LWW + deterministic tie-break, tombstone deletes, outbox pattern). Extend it with ticket/ticket-message tables and repo functions; don't stand up a second, parallel local-storage system for tickets.

1. **Local schema** — `ticket` and `ticket_message` tables mirroring the hosted shape, plus an outbox entry type for "new ticket" and "new message."
2. **The one real design wrinkle vs. devices**: every local device row already has a stable, server-assigned key (TRMM's `agent_id`) before it ever reaches the local DB — there's no "create device locally" case. **A brand-new ticket does NOT have a server id until it's synced.** Give a locally-created ticket a local-only temporary id; on first successful sync, reconcile it to the real server-assigned id (swap the local row's key, don't create a duplicate). Handle the same for a locally-added reply to a ticket that hasn't synced yet. Get this reconciliation right — it's the one place this genuinely isn't just "copy the devices pattern."
3. **Auth for the local ticket routes**: same as the rest of the EXE's local API surface — gated by `isLocalExeRuntime()`, no web session available. Resolve the real `User` the same way already established for the license itself: match the activated license's stored `licensee` email to the real `User` row server-side when syncing (this was flagged as the actual gap in the original Task 44 design doc's "what already exists" section — the admin ticket view already shows the submitter's email; what's missing is the EXE-side submission surface, not anything server-side).
4. **Local UI**: `/local/tickets` (list) and `/local/tickets/[ticketId]` (detail/reply), following the exact route-naming convention `/local/devices` already established. Reuse existing ticket components (`app/dashboard/support/page.tsx`, `[ticketId]/page.tsx`) where the shape matches, same as `components/device-card.tsx` grew optional props instead of a parallel component.
5. **Sync**: extend whatever transport increment 2 builds for devices (`app/api/desktop/sync/*`) to also carry ticket/message deltas, rather than standing up a second sync pipe — confirm the exact mechanism against what actually landed for devices before building this, since that'll dictate the cleanest way to add a second resource kind to it.

## Explicitly out of scope

- Any change to the hosted web ticket UI/routes — those stay as-is, this only adds the EXE-side mirror.
- Admin-side changes — the admin ticket view already shows submitter email/assignment; not touched here.

## Verification required before calling this done

1. Real VM test: submit a new ticket from inside the installed EXE while online — confirm it appears on the hosted web admin/support view with the correct user attached (via the license-email match, not a session).
2. Offline test: draft and "send" a new ticket message while the VM is disconnected from the hosted backend — confirm it queues locally (outbox) and actually delivers once reconnected, without creating a duplicate ticket.
3. Reverse direction: a staff reply sent from the web admin should appear in the EXE's local ticket view after the next sync, not require a manual refresh-and-hope.
4. Confirm the temp-id-to-real-id reconciliation for a ticket created fully offline (create it disconnected, add a reply also disconnected, then reconnect) — exactly one ticket should exist server-side afterward, not two.

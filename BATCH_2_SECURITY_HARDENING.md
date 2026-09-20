# Batch 2 of 3 — Vantra security hardening

**Give this file's path to Cline as its own, self-contained instruction.** This is Batch 2 in a 3-batch sequence — Batch 1 (SpaceWorker security hardening) was handled separately and doesn't affect this repo. Do not start Batch 3 (SpaceWorker admin visibility + export filter) — that's a separate handoff the owner gives you later.

## Before you start

Read `HOW_WE_MOVE_FAST.md` in this repo root — it points at SpaceWorker's fuller version of the same playbook (deploy, migration, and live-verification mechanics) and notes the two real differences in this repo's layout (no `app/` subdirectory trap, runs as the `vantra` system user on port 3300). Follow that playbook, not an improvised process.

## Why this batch, in this order

Three real findings from a 2026-09-20/21 security audit. This repo's baseline is notably strong already (every admin route and device-ownership check was re-verified clean; the self-service license transfer flow is genuinely session-gated, a materially different and stronger design than the bug SpaceWorker's Task 49 had — you do NOT need to touch that flow here). These three are real but narrower gaps:

1. **`TASK_46_DESKTOP_SYNC_MACHINEID_SPOOFING.md`** — most severe of the three (a non-secret, product-published Device ID is used as a bearer credential for cross-org data access). Do this first.
2. **`TASK_47_RATE_LIMIT_EXE_LICENSE_AND_CALLBACK_ROUTES.md`** — mechanical, and its own task file already contains the exact `RateLimitKind` code to add. Do this second, partly because Task 46's fix (a new install-secret) and Task 47's rate limiting both touch the desktop-sync/license surface, so doing them back to back avoids re-reading the same files twice.
3. **`TASK_45_ADMIN_DEVICE_CREDENTIAL_VISIBILITY.md`** — additive-only, read-only admin UI, lowest risk of the three (nothing about the existing request/store/reveal flow changes). Do this last in this batch.

Full detail, exact file:line references, and the fix + verification steps for each are in their own `TASK_NN_*.md` file — read each one fully before starting it. This batch doc is sequencing + guardrails, not a duplicate of that detail.

## How to work through this batch

For **each** task, in order:

1. Read the task file fully.
2. Implement the fix. Task 46 needs a schema change (a new install-secret column) — if there's no local Postgres available, write the migration SQL by hand following this repo's existing migration file style (matching `HOW_WE_MOVE_FAST.md`'s SpaceWorker §3, which applies here the same way, just without the `app/` subdirectory distinction).
3. `npx tsc --noEmit -p .` — must be clean before moving on.
4. Write a disposable, self-cleaning E2E script per the playbook and run it against the real deployed server (`http://localhost:3300` on the VPS) for anything the task's "Verification expected" section calls for a live check on. Task 45's admin-tab check and Task 46's auth-rejection check both need this — don't skip it.
5. Deploy per the playbook (migrate → generate → build → restart, in that order, if a schema change is involved). Confirm `vantra.service` comes back `active` and a real `curl` to `http://localhost:3300/` returns 200 before considering the task done.
6. Commit the fix with a message stating what the bug was and how you verified the fix.
7. Push.
8. Update that task's own `.md` file's `**Status: ...**` line to say it's fixed and how it was verified.
9. Move to the next task in this batch.

## Guardrails

- Stay inside these three tasks. Task 46's fix touches `lib/exe-license-bind.ts` and the desktop-sync routes — don't use that as a reason to also "improve" the licensing/self-service flow itself; that was separately re-verified sound this audit and is explicitly out of scope (see Task 46's own "Explicitly out of scope" section).
- Don't touch `lib/machine-id.ts`'s derivation logic — Task 46 is about how the value is USED as a credential, not how it's computed; changing the derivation would be a much bigger, unrelated change.
- Task 45 is read-only admin surface only — don't add any new reveal/decrypt capability while you're in that area.
- Existing untracked `TASK_27...md` through `TASK_40...md` files sitting in this repo's root are the owner's own pre-existing work-in-progress notes from before this audit — don't touch, move, or delete them.

## When the batch is done

Once all three tasks are implemented, verified live, committed, and pushed: **stop.** Report back, per task: what the bug was, exactly what you changed (files), and exactly how you verified it. Don't start Batch 3 — the owner will hand that over separately once they've reviewed this one.

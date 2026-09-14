# Task 43 — Pause + concurrency limits for the RAM-heavy mechanisms

**Status: ready to build.** Companion to SpaceWorker's matching task (`TASK_46_QUEUE_ADMISSION_CONTROL.md` in that repo) — same concept, applied to each app's own heavy mechanisms. Once Task 41 (Unified Ops Console) ships, both apps' Queue tabs are naturally visible together there — this task doesn't need to build any cross-app plumbing itself.

## The ask, as given (2026-09-14)

> Also add to the admin for space worker, and vantra, each high mechanism that will take so much ram power, I want a button to turn on and off queue for that mechanism and in front a way to change how many can be in the queue at a time. And I need each platform arrange under a queue section so I can easily do what's needed to save ram and increase workload as needed while we plan to upgrade the server.

Context: this VPS runs Vantra, its own TRMM backend (Django/Celery/Daphne — `lib/generation-queue.ts`'s own comment confirms this), MeshCentral, AND SpaceWorker, all on one box — genuinely resource-constrained until a planned upgrade. `lib/services-control.ts` already gives the admin coarse systemd start/stop/restart over `meshcentral.service`/`celery.service`/`celerybeat.service`/`daphne.service`/`spaceworker.service`, already platform-tagged (`"vantra" | "spaceworker" | "shared"`) for the admin Platform pages — this task adds a FASTER, narrower dial on top: pause new work admission without killing the whole service, plus an adjustable concurrency cap, for the specific mechanisms that actually spend RAM.

## The mechanism in this app that actually spends real RAM

Confirmed by reading the code: **installer generation** (`lib/generation-queue.ts`) — bounds concurrent installer-generation work (Add Device: merged/separated/msi builds), each holding PDF/ico upload buffers in memory plus outbound calls to TRMM and the MSI generator service. Currently hardcoded: `const MAX_CONCURRENT = 5; const MAX_QUEUE_DEPTH = 20;`, in-memory only (resets on restart).

**Audit for anything else before starting**: this was found via a reasonably thorough but not exhaustive search of this session — Cline should specifically check whether `lib/technician-session.ts` (private technician sessions) or anything MeshCentral-session-related spends REAL LOCAL RAM on this VPS (as opposed to running on the remote device, which `lib/technician-session.ts`'s `sendRawCmd`-based design appears to do — it manipulates a second Windows desktop object ON THE REMOTE MACHINE, not locally, so it's likely NOT a local RAM concern, but confirm rather than assume) before scoping this to installer generation alone.

## 1. Make the limit admin-adjustable and persisted (not hardcoded, not in-memory-only)

Extend `AdminSetting` (the singleton-row pattern already used for wallets/pricing):
```prisma
model AdminSetting {
  ...
  installerGenEnabled       Boolean @default(true)
  installerGenMaxConcurrent Int     @default(5)
  installerGenMaxQueueDepth Int     @default(20)
}
```
Defaults match today's hardcoded behavior exactly — purely additive.

`lib/generation-queue.ts`'s in-memory `active`/`waiting` counters can stay in-memory (matching its own documented rationale — single Node instance, resets harmlessly on restart) — only the two CONSTANTS need to become a live read from `AdminSetting` instead of a fixed number, plus a new `enabled` check: when `false`, reject new generation requests immediately (a clear "installer generation is temporarily paused" message) regardless of current queue depth, without touching in-flight generations already running.

## 2. A dedicated "Queue" admin tab

New tab in `/admin101`'s nav (alongside Background Jobs, Services, Platform) showing the mechanism: name, a toggle switch, a number input for max-concurrent (and max-queue-depth) with an immediate save, and a live "N of MAX_CONCURRENT active, N waiting" readout pulled from `lib/generation-queue.ts`'s actual current state — genuinely useful for the RAM-management framing, not just a static setting.

## Explicitly out of scope

- Any change to `lib/services-control.ts`'s existing systemd start/stop/restart controls — this is a narrower, faster-acting layer on top, not a replacement.
- Auto-scaling or automatic adjustment based on real server load — manual dials only, for now.

## Verification expected

- `npx tsc --noEmit` / `npm run build` clean; migration applied.
- Live: lower `installerGenMaxConcurrent` to 1, confirm a second simultaneous installer request genuinely queues instead of running immediately (previously would run up to 5 at once); restore to 5, confirm behavior matches today.
- Live: toggle `installerGenEnabled` off, confirm a new installer request is rejected with the pause message while a request already in flight completes normally; toggle back on, confirm new requests work again.
- If the technician-session/MeshCentral audit above finds a second genuinely local-RAM mechanism, apply the exact same pattern to it too and note the finding in the PR description either way (confirmed none found, or confirmed one found and handled).

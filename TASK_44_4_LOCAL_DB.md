# Task 44.4 — Vantra Desktop EXE: local DB, starting with devices only

**Status: ready to start. Task 44.3 (EXE packaging) is now genuinely done** — verified 2026-09-18 by installing and launching the real packaged EXE on the Windows VM (not just CI passing): silent install, process launch, the bundled Next.js sidecar actually serving on `127.0.0.1:34513`, `GET /exe` → 200, `POST /api/exe-license/status` → 200 with a correct fresh-trial response. A real bug was found and fixed along the way (the bundled Node binary was at the wrong path — see `src-tauri/src/main.rs`'s `find_node_binary`) — CI passing alone had NOT caught it; only the real launch test did. Keep doing real Windows VM launches for every future EXE-shell change, not just CI.

## Where this sits in the plan

Per `TASK_44_VANTRA_DESKTOP_EXE.md`'s suggested build order: this is step 5, "Local DB implementation against the design from step 1, starting with devices only (the concretely-named case), expanding to other surfaces once that's proven."

Design doc (already written, reviewed, and owner-confirmed): `TASK_44_DESIGN_LOCAL_DB.md`. Read it in full before writing any code — it already answers schema shape, sync direction/frequency, and conflict handling (asymmetric field-authority + LWW-with-deterministic-tie-break + tombstone deletes). This task is about *implementing* that design for the devices surface specifically, not re-deciding it.

## The architectural connection this task must make explicit

Task 44.3 shipped the EXE as a **thin license-gate runtime** (`TASK_44_3_EXE_PACKAGING.md`'s Option 2, owner-confirmed): only the license/settings surface is served locally; the Tauri window navigates to the **hosted** app (`https://vantra.instaweb.top`) for everything else, including devices, once the license gate passes (`components/exe-gate.tsx` does this navigation today).

This task changes that for devices specifically: once a local devices DB and its own local UI/API routes exist in the bundled runtime, the Tauri window should show the **local** devices surface instead of navigating to the hosted one for that surface — the whole point of "real local DB, not a cache" per the design doc's confirmed answer #1 ("the app works independently of Vantra's backend for normal device management/viewing"). Other surfaces (tickets, settings, billing) keep going to the hosted app until/unless a later task moves them too. Don't build a local DB with nothing local actually consuming it — that leaves the EXE unchanged from the user's perspective and doesn't test the thing that actually matters (does the local-first flow really work offline).

## Scope for this task

1. **Local schema** (SQLite via `better-sqlite3`, per the design doc) — devices table only, keyed by TRMM `agent_id` per the design's field-authority model.
2. **Local API routes** inside the bundled runtime (`app/api/...` equivalents that read/write the local SQLite DB instead of the hosted Prisma/Postgres DB) — reuse the *shape* of the existing hosted `/api/devices` response (the client already renders that shape) but back it with the local DB. Gate these routes behind `isLocalExeRuntime()` / `VANTRA_LOCAL_EXE`, matching every other EXE-only code path in this repo.
3. **Local devices UI** — the bundled runtime needs a route the Tauri window can navigate to that renders the devices list/detail against the local API, not the hosted one. Reuse existing components (`components/dashboard-client.tsx`, `device-card.tsx`, etc.) where the shape matches; a thin local wrapper page is fine, following the `/console/[agentId]` precedent from earlier this session (a small, purpose-built page rather than dragging in the full hosted `Shell` layout).
4. **Sync path** — the one confirmed backend dependency device management still has: pushing local device state to the hosted DB as backup/mirror, and pulling remote-added devices down. Match the design doc's stated direction/frequency; don't invent a different sync model.
5. **Tauri navigation update** (`src-tauri/src/main.rs` / `components/exe-gate.tsx`) — after the license gate passes, route to the local devices surface instead of the hosted dashboard, for the devices case specifically.
6. **Conflict handling** — implement exactly what the design doc specifies (asymmetric field-authority, LWW-with-deterministic-tie-break, tombstone deletes) for the concrete case of two writers: a local EXE install and the hosted web dashboard both touching the same device (e.g., a label rename) roughly simultaneously.

## Explicitly out of scope for this task

- Any other surface (tickets, settings, billing) moving to local-first — devices only, per the design doc's own "starting with devices only" guidance.
- "Desktop mode" account-state switch and web-access narrowing (Task 44's step 6) — a separate task, comes after this one.
- Admin bulk remote execution (step 7) and auto-update (step 8) — later, unrelated to local DB.

## Verification required before calling this done

Same non-negotiable bar as every EXE deliverable this session — CI passing is necessary but proven insufficient on its own (see this task's own opening section):

1. Real install + launch on the Windows VM, not just `cargo check`/CI green.
2. With the VM offline (disconnect it from the network, or block the hosted app's domain), confirm the local devices surface still loads and is usable — this is the actual claim being tested ("the app works independently of Vantra's backend for normal device management/viewing"), so it needs to be tested under the condition that would break a fake/cached version of the same feature.
3. Reconnect and confirm the sync path actually reaches the hosted DB (a device labeled locally while offline shows the new label on the hosted web dashboard afterward, and vice versa).
4. A real conflict test: rename the same device's label from both the local EXE and the hosted web dashboard within the sync window, and confirm the outcome matches the design doc's stated resolution rule, not an arbitrary one.

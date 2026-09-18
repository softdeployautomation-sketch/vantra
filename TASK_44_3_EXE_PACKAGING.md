# Task 44.3 — Vantra Desktop EXE packaging (Tauri shell + bundled standalone server + Windows CI build)

**Status: not started — this is the next unbuilt phase of Task 44.** Design (44.1) and licensing/auth (44.2/44.2b/44.2c) are done and deployed; this repo has no `src-tauri/` directory and no EXE build workflow yet.

## Where this sits in the plan (`TASK_44_VANTRA_DESKTOP_EXE.md`'s suggested build order)

1. ~~Local-DB architecture design~~ — done (`TASK_44_DESIGN_LOCAL_DB.md`, all open questions answered).
2. ~~License-activation-in-Settings~~ — done (Task 44.2).
4. ~~Email+license auth path + license gate + Vantra's own admin generator~~ — done, built alongside 44.2/44.2b/44.2c (`lib/exe-license.ts`, `lib/exe-license-validator.ts`, `lib/exe-license-bind.ts`, `lib/exe-eligibility.ts`, `lib/exe-runtime.ts`, `lib/license-state.ts`, `/admin101/exe-licenses`).
3. **← THIS TASK. EXE packaging.**
5. Local DB implementation (against the 44.1 design) — not started.
6. "Desktop mode" account-state switch + narrowed web access + EXE-side ticket submission — not started.
7. Admin bulk remote-execution — not started.
8. Auto-update — not started.

Steps 5-8 depend on a real packaged shell existing first, so this is correctly next regardless of note-taking gaps.

## Required reading before writing any code

`EXE_BUILD_LESSONS_LEARNED.md` in the **spaceworker** repo (`/Users/mikeolab/spaceworker/EXE_BUILD_LESSONS_LEARNED.md`), in full, before starting. It documents real bugs hit building SpaceWorker's Extractor EXE — this is not optional background reading, several of these are one-line mistakes with total-failure severity that compile clean and show no error:

- `tauri::Builder::run()` vs `.build()` — `.build()` never starts the event loop; the window never appears and the process exits almost immediately. No CI check catches this — only launching the real packaged EXE on Windows does.
- Next's `output: "standalone"` file tracer can copy raw `.ts` source into the bundled runtime — scrub every `.ts`/`.tsx` file from the assembled tree as a defensive last step regardless of diagnosed cause.
- A fail-closed build guard: abort the build if the resolved license secret still equals a dev/placeholder value.
- NSIS stages `bundle.resources` entries that point outside `src-tauri/` under a literal `_up_/` folder in the installed app — runtime resource-path lookup must probe multiple candidate paths, not assume one layout.
- Windows needs the full `node.exe` + its dist bundled, not just the app code.
- Layout/UI bugs can only reproduce at the real packaged window size — a browser dev-tools resize is not a substitute.
- CI builds from `origin/main`, not local commits — a "done" report that wasn't actually pushed will silently build stale code.

## Architecture: how the packaged EXE reaches the real backend (resolved 2026-09-18)

Confirmed by checking SpaceWorker's actual shipped build, not just its docs: `scripts/runtime-assemble.mjs` deletes the repo `.env` entirely and writes only `SPACEWORKER_LOCAL_EXE=true`, `BUILD_TARGET`, `EXE_LICENSE_SECRET`, `NEXT_TELEMETRY_DISABLED=1` — **no `DATABASE_URL`, ever, not even scoped.** The Extractor's real work doesn't touch the prod DB locally; `isLocalExeRuntime()` gates DB-touching code paths off.

Vantra follows the same rule, with one addition since Vantra (unlike the Extractor) has no local DB yet at this phase:

- **Bundle locally**: only the license/settings surface — same minimal env pattern (`VANTRA_LOCAL_EXE=true`, `EXE_LICENSE_SECRET`, `BUILD_TARGET`, no DB credential of any kind). This has to run locally and offline because the 24h silent trial must work without network — it validates against the embedded HMAC secret via `lib/exe-license-validator.ts`, exactly like the already-built Settings/License panel.
- **Everything else — devices, tickets, dashboard, all of it — the Tauri window loads the HOSTED app** (`https://vantra.instaweb.top`) over normal HTTPS, same as a browser today. Do not bundle the full app or any `DATABASE_URL`/prod secret to make the rest work "offline" at this phase — there's no local DB to justify it yet (that's Task 44.4), and shipping a live DB credential — even least-privilege — to every installer download is exactly the exposure this task's own verification checklist exists to catch.
- This also sets up 44.4 cleanly: as local DB lands, surfaces migrate one at a time from "hosted page in the window" to "served by the local runtime," instead of an all-or-nothing cutover.

## Scope for this task

Reuse SpaceWorker's proven pattern (`spaceworker/src-tauri/`, `spaceworker/scripts/runtime-assemble.mjs`, `spaceworker/.github/workflows/build-exe.yml`) as the template — same shape, adapted to Vantra:

1. **Tauri shell** (`vantra/src-tauri/`) — window config, `tauri.conf.json` pointing at a bundled Vantra runtime resource dir (license/settings surface only, per the architecture above), using `.run()` (not `.build()`) from the start. After the license gate passes, navigate the window to the hosted app for everything else.
2. **Runtime assembly script** (`vantra/scripts/runtime-assemble.mjs` or equivalent) — builds Vantra's Next.js app with `output: "standalone"`, copies the standalone tree into the Tauri bundle's resources, scrubs `.ts`/`.tsx` source files, writes a fresh minimal `.env` containing ONLY `VANTRA_LOCAL_EXE=true`, `BUILD_TARGET`, `EXE_LICENSE_SECRET`, `NEXT_TELEMETRY_DISABLED=1` — no `DATABASE_URL`, no other prod secret. Check `lib/exe-runtime.ts` for the exact flag `isLocalExeRuntime()` reads.
3. **Fail-closed secret guard** in the assembly script — abort if the resolved license secret matches any known dev/placeholder value.
4. **Windows CI workflow** (`.github/workflows/build-exe.yml` or similar) — builds from `origin/main`, produces a real NSIS installer artifact.
5. **Resource-path probing** in the Tauri Rust side — multiple candidates including the `_up_/` case, matching SpaceWorker's working pattern.

## Explicitly out of scope for this task

- Local DB (step 5) — the EXE at the end of this task still talks to Vantra's backend for everything; it does not yet have an offline-first local DB. That's the next phase after this one.
- Desktop-mode account switch, narrowed web access, ticket submission surface (step 6).
- Admin bulk remote execution (step 7).
- Auto-update (step 8).

Landing a real, installable, launchable Vantra EXE that runs the existing web app locally (hitting the real backend, license-gated, same as today's browser experience) is the whole and only goal here.

## Verification required before calling this done (non-negotiable, same as every EXE deliverable this session)

1. Confirm the change is actually pushed to `origin/main` (`git fetch origin && git status --short --branch`) — not just committed locally.
2. Let CI build the real installer artifact.
3. Download and independently unpack the actual artifact (`7z x` works on NSIS installers) and verify:
   - Zero `.ts`/`.tsx` files outside `node_modules`.
   - No real production secret values or the known placeholder secret string present anywhere in the unpacked tree.
4. Install and actually launch the packaged EXE on the real Windows VM — confirm a window appears, the app loads, and the license gate/trial behaves as expected. A build that only passes CI checks is not verified; only a real launch on the target OS is.

## Next phase after this lands

Task 44 step 5 — local DB implementation against the `TASK_44_DESIGN_LOCAL_DB.md` design, starting with devices only.

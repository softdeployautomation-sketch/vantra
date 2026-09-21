# Task 83 — Redirect policy: legacy web domains 301 → new canonical hosts

**VERDICT 2026-09-22: NO REDIRECTS YET — dependency sweep blocked both.**
The sweep (checklist step 1) found live POST traffic from shipped desktop
EXEs on BOTH legacy domains; a 301 turns POST into GET (fetch follows 301s
by re-issuing as GET per spec), breaking those EXEs. Redirects are deferred
to Task 85, gated on the EXE rebuild (Task 84) + old-EXE sunset. Nothing was
changed on the VPS.

## Sweep findings (verified 2026-09-22)

**vantra.instaweb.top** — 8 hardwired refs in live vantra code:
- `lib/local-db/sync.ts:32` — EXE local-db sync POSTs here (EXE_SYNC_HOST
  default). **301 would break shipped EXEs' sync (POST→GET).**
- `components/exe-gate.tsx:31`, `components/exe-first-launch.tsx:17`,
  `lib/exe-runtime.ts:28`, `app/activate-complete/page.tsx:18` — HOSTED_APP_URL
  constants (absolute-URL navigations; a 301 with preserved path would
  survive these, but the sync one above still blocks).
- `components/admin/admin-platform-detail-client.tsx:108` — display link.
- Also mirror copies deployed at /opt/vantra (in sync with local repo).

**spaceworker.instaweb.top** — NOT a static copy; it is the live SpaceWorker
OS app (port 3500) with functional nginx routes (/browser/ streaming,
loopback-only /api/internal, 200s IMAP timeouts, maintenance fallback). The
new spaceworker.top vhost mirrors all of them verbatim (verified line-by-line
during Task 81) — so a path-preserving 301 would be technically sound EXCEPT:
- `lib/hosted-fetch.ts` (spaceworker repo) — EXE account/license/payment
  calls POST to `HOSTED_APP_URL = https://spaceworker.instaweb.top`
  (`lib/exe-runtime.ts:37`). **301 would break shipped SpaceWorker EXEs.**
- `components/admin/ops-console.tsx:155` — ops console iframes
  `spaceworker.instaweb.top/admin`; after a 301 the iframe lands on
  spaceworker.top where the SpaceWorker session cookie (bound to the old
  domain) doesn't exist → one-time re-login inside the iframe. Acceptable
  but must be flagged to the owner.
- `app/page.tsx:110` — cosmetic store-link text.

## Consequential plan changes

- Code repoint of ALL hardwired refs (vantra ×8, spaceworker ×3) moves into
  **Task 84**, before the EXE rebuild, since the rebuilt EXEs must carry the
  new hosts anyway.
- The 301s themselves move to **Task 85** (vhost retirement step), executed
  only after old-EXE sunset is confirmed (TRMM/audit evidence of no active
  old builds).
- Task 85's checklist gains: re-verify ops-console iframe login after the
  spaceworker.instaweb.top redirect, and a POST-curl check (sync +
  hosted-fetch paths) against the 301 before flipping.

## Original checklist (now superseded — kept for reference)

1. Dependency sweep — **DONE, blocking** (above).
2. vantra.conf → 301 — **BLOCKED** (EXE sync POSTs).
3. spaceworker.instaweb.top → 301 — **BLOCKED** (hosted-fetch POSTs).
4. nginx reload + curl verify — n/a until 2-3 unblock.
5. Old-EXE flow verification — n/a.
6. Record results — done (this doc).

## Rollback

None needed — no changes were made.

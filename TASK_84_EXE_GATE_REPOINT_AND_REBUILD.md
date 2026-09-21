# Task 84 — Repoint EXE gate + rebuild the Vantra desktop EXE

**Priority: second** (unblocks Task 85). The shipped desktop EXE has old
domains baked in; the web side has one hardcoded legacy host.

## Known baked-in references

- `components/exe-gate.tsx:31` — `HOSTED_APP_URL =
  "https://vantra.instaweb.top"` (hardcoded; redirects EXE users to
  `/workspace`). Change to `https://vantra.spaceworker.top`.
- `lib/exe-license.ts:42-44` — `EXE_DOWNLOAD_URL` default
  `https://dl.instaweb.top/e/vantra-desktop` — already correct family, no
  change needed (override env `VANTRA_EXE_DOWNLOAD_URL` is unset on the VPS).
- The EXE binaries themselves (owner-paced build) may embed old hosts — only
  a rebuild clears those.

## Checklist

- [ ] 1. Edit `components/exe-gate.tsx:31` → HOSTED_APP_URL =
      `https://vantra.spaceworker.top`; `npx tsc --noEmit` + eslint.
- [ ] 2. Deploy to VPS (single-file rsync + build + restart vantra.service).
- [ ] 3. Rebuild the Vantra desktop EXE with the generator (owner-paced):
      verify which hosts the launcher-build embeds — grep
      `vantra-installer/generator/src/` (launcher-build.ts, routes.ts, env.ts)
      for any old-domain constants before building.
- [ ] 4. Upload the new EXE to the dl host path the web app advertises.
- [ ] 5. E2E with the NEW exe: license gate → lands on
      vantra.spaceworker.top/workspace; license activate/transfer flow green.
- [ ] 6. Keep the OLD exe downloadable/servable until Task 85 confirms no
      active installs depend on the legacy hosts (check EXE audit log for
      recent activations on old builds).

## Rollback

exe-gate change is one constant; .env.bak pattern + prior EXE retained.

# Task 83 — Redirect policy: legacy web domains 301 → new canonical hosts

**Priority: first.** Lowest-risk consolidation step. Old web domains currently
serve 200 in parallel with the new canonical hosts; converting them to 301s
makes the new hosts canonical without breaking anything that reads the URL
path (301s preserve paths).

## Current state (verified 2026-09-22)

- `vantra.instaweb.top` → serves the OLD Vantra app copy (legacy vhost
  `vantra.conf`), while canonical is `vantra.spaceworker.top`.
- `spaceworker.instaweb.top` → serves the OLD SpaceWorker site copy
  (legacy `spaceworker.instaweb.top` vhost), canonical is `spaceworker.top`.

## Checklist

- [ ] 1. **Dependency sweep first** (blocks the whole task if any hit):
      grep baked-in hosts in the current desktop EXE consumers —
      `components/exe-gate.tsx:31` (`HOSTED_APP_URL =
      https://vantra.instaweb.top` — hardcoded redirect, NOT path-preserving:
      it uses `window.location.replace` with its own params, so a 301 is fine
      only if the query string survives; verify). Also check any docs/QR/links
      in the SpaceWorker site repo pointing at spaceworker.instaweb.top.
- [ ] 2. Edit `/etc/nginx/sites-available/vantra.conf`: replace the app
      proxying location with a 301 to `https://vantra.spaceworker.top`
      (same vhost, `return 301 https://vantra.spaceworker.top$request_uri;`).
      Keep the cert block (the old EXE still TLS-handshakes with this host).
- [ ] 3. Same for the `spaceworker.instaweb.top` vhost → 301 to
      `https://spaceworker.top`.
- [ ] 4. `nginx -t` → reload → curl-verify: both hosts return 301 with the
      original path; following the redirect lands 200 on the canonical host.
- [ ] 5. Confirm the deployed (old) EXE flow still works end-to-end after the
      redirect: EXE license check → gate redirect → workspace loads.
- [ ] 6. Record results; commit the task doc.

## Rollback

`cp` each edited vhost to `.bak-task83` before edit; restore + reload.

## Explicitly out of scope here

Retiring the vhosts entirely (Task 85) and the rmm/mesh legacy hosts
(also Task 85 — agent/API traffic must NOT be 301'd mid-flight).

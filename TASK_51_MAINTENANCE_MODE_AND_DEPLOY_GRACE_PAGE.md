# Task 51 — Admin-toggleable maintenance page for web + EXE, instead of raw errors during deploys

**Status: ready to build. Owner-requested 2026-09-21.** Companion to SpaceWorker's `TASK_56_MAINTENANCE_MODE_AND_DEPLOY_GRACE_PAGE.md` — same design, ported here rather than duplicated in full; read that file for the complete reasoning, this one just calls out what's specific to Vantra.

## What's requested (same as SpaceWorker's Task 56)

"Instead of showing 502 or error to users, lets have a page showing update is on the way, check back soon or wait some minutes, and make sure the page keeps reloading until the updates is cleared and the page loads the right page" — admin-controllable, for both the web dashboard and the EXE.

## The two mechanisms — build both, they cover different failure windows

1. **nginx-level fallback** (`error_page 502 503 504`) pointing at a small static HTML page served directly by nginx, independent of the Next.js app — this is the ONLY thing that can respond during the exact seconds `systemctl restart vantra.service` has the process down and nothing inside the app can run at all. Add to `/etc/nginx/sites-enabled/vantra.conf` (per `HOW_WE_MOVE_FAST.md` §0's access notes — same VPS, same key). The page: "We're updating — this page will reload automatically," small inline script polling `fetch(location.href, {cache:"no-store"})` every few seconds and `location.reload()` once it gets a real 200 back instead of another 502.
2. **Admin-toggleable DB flag** for planned maintenance windows (a deploy about to happen, or — relevant here specifically — a DNS/domain cutover per `PLAN_DOMAIN_SEPARATION.md`). Add `AdminSetting.maintenanceModeWeb Boolean @default(false)` — Vantra's version can likely stay a SINGLE flag rather than SpaceWorker's two (`maintenanceModeWeb` / `maintenanceModeExeApi`), because Vantra's EXE is architecturally a thin wrapper that redirects into the same `vantra.instaweb.top` dashboard rather than making its own separate hosted-API calls the way SpaceWorker's EXE does (confirmed this session, see `PLAN_DOMAIN_SEPARATION.md`'s topology notes) — one flag covering web naturally covers the EXE too, since it's the same requests. Re-evaluate this if the domain-separation plan later gives Vantra's EXE its own separate API surface.

Enforce it in `proxy.ts`, before the existing session-scope logic, for everything except `/admin101/**` (never lock the admin out of the toggle) and static assets. Cache the DB read with a short in-memory TTL (5-10s) rather than hitting Postgres on every request — same reasoning as SpaceWorker's version.

## Admin UI

A toggle in `app/admin101/(protected)/...` — find the existing ops/services-control page (`components/admin/ops-console.tsx` was referenced this session for the extraction-worker-equivalent controls on SpaceWorker's side; check whether Vantra has an equivalent "Services" admin page already, and put it there) alongside whatever existing service start/stop controls already live there.

## What's genuinely different from SpaceWorker here

- Vantra's EXE has no separate `HOSTED_APP_URL`-driven API surface to add Mechanism 3 (client-side retry wrapper) to in the same way — its EXE gate (`components/exe-gate.tsx`) makes exactly ONE call, to its own LOCAL `/api/exe-license/status`, before redirecting into the real dashboard. Once redirected, a maintenance-mode hit is just a normal web page load and Mechanisms 1+2 already cover it. Confirm this is actually true before skipping a client-side retry wrapper entirely — check whether `exe-gate.tsx`'s own local status check, or anything else genuinely startup-blocking, could itself hang/error during a maintenance window in a way that needs its own friendly handling.

## Verification expected

- `npx tsc --noEmit` clean; migration applied.
- Live: flip the toggle on, confirm the dashboard shows the maintenance page, confirm `/admin101/**` still works, confirm it clears automatically once toggled off.
- Live: time a real `systemctl restart vantra.service` and confirm a request in that exact window hits the nginx fallback, not a raw 502, and auto-reloads into the real page once the restart completes.

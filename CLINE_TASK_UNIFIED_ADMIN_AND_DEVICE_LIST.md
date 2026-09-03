# Cline Task — Unified instaweb Admin Monitoring + Device List Cleanup

**Repo**: `/Users/mikeolab/vantra` (Next.js 16.2.9 / React 19 / Tailwind v4 / Prisma + Postgres)
**Scope**: App code only. **All server/infra work is already DONE and verified — do not touch the VPS, systemd, sudoers, or the deploy pipeline.**

---

## Why this exists

Vantra and a second product, SpaceWorker (`spaceworker.instaweb.top`, a separate Next.js app on the same Contabo VPS with its own systemd service, own Postgres database, own deploy path — zero shared state with Vantra), now share the same box. The user wants one shared admin view across both, and separately found real UX problems with the device list after using it more (raw internal identifiers leaking into the UI, no relative timestamps, cramped org-name placement).

This task has two parts. Part A is small and mechanical (extend the existing service-control panel). Part B is a device-list redesign with one item requiring a live TRMM API check before you commit to a design — read it before writing any code.

## Infra already in place (verified live — build against these exact facts)

- **`spaceworker.service` is now in the same sudoers allowlist as the other 4 controllable services.** `/etc/sudoers.d/vantra-services` grants the `vantra` system user exactly 15 commands (5 services × 3 actions: start/stop/restart), verified live:
  - `sudo -n /usr/bin/systemctl restart spaceworker.service` → **exit 0 (allowed)**
  - `sudo -n /usr/bin/systemctl stop rmm.service` → **denied** (unchanged, still protected)
- SpaceWorker's systemd unit is `spaceworker.service`, listening on `127.0.0.1:3500`. Its own health/liveness can be checked the same way Vantra checks TRMM's reachability today — a plain HTTP request to `http://127.0.0.1:3500/` (200 = up).
- Everything else about the service-control mechanism (`lib/services-control.ts`'s `execFile`-only pattern, no shell, fixed argument arrays, the `listServiceStates()`/`controlService()` split, the `MemoryCurrent` parsing gotcha) is unchanged from the original `CLINE_TASK_VPS_SERVICE_CONTROLS.md` — read that file if you haven't already, this task assumes it's done and builds on top of it.

## Part A — Add SpaceWorker to the Services panel

1. In `lib/services-control.ts`: add `"spaceworker.service"` to `CONTROLLABLE_UNITS`, and add it to the `SERVICES` list with `label: "SpaceWorker"`, `impact: "SpaceWorker (the lead-extraction/outreach product) becomes unreachable at spaceworker.instaweb.top for all its users. Vantra and TacticalRMM are unaffected."`, `controllable: true`.
2. It is **not** in the protected list — unlike `rmm.service`, there's no reason to block stopping it (it doesn't back any shared infra Vantra depends on).
3. The existing `/admin101/vps` Services table, `POST /api/admin/services` route, and `ConfirmDialog` wiring all already generalize over the `SERVICES`/`CONTROLLABLE_UNITS` lists — no route or component changes needed beyond the two list entries above, per the original task's design.
4. Update the standing "what does stopping each service cost" note/table in the VPS tab (wherever the original task rendered per-service impact copy) to include this new row.

## Part B — Shared platform status + admin panel rebrand

1. **Rebrand the admin panel identity** from "Vantra admin" to something covering both products — e.g. "instaweb platforms" or "instaweb admin" (exact wording is a small UI-copy decision, use your judgment; keep it short since it appears in a header/title). This is UI copy only — `/admin101`'s URL, auth mechanism (shared passcode via `ADMIN_TOKEN`), and session cookie all stay exactly as they are; do not rename routes or env vars.
2. **Add a platform-status section** to the admin dashboard (wherever the main `/admin101` landing page currently is) showing two tiles: "Vantra" and "SpaceWorker", each with an up/down badge. Vantra's own liveness is trivially "up" (the admin panel itself is Vantra, so if this page renders, Vantra is up) — but check for a more meaningful signal if one already exists in the codebase (e.g. DB connectivity). SpaceWorker's liveness: a server-side `fetch("http://127.0.0.1:3500/", { signal: AbortSignal.timeout(5000) })` from an API route or server component, same pattern as any other reachability check already in this codebase (see `lib/system-status.ts` if it exists from the original VPS-controls task — reuse `pingUrl` if so, rather than writing a new one).
3. Each tile should be a simple compact "up (green) / down (red) / checking" indicator — this is a status summary, not a duplicate of the full Services table from Part A.

## Part C — Device list: stop leaking internal identifiers

**The bug**: the device list currently renders raw TRMM-internal strings the customer should never see. Two confirmed instances from a live screenshot:
- The TRMM `client_name` (the internal `vantra-{userId}` slug — per this project's own v1 design decision, TRMM client names are deliberately never customer-facing) is rendering directly under the hostname.
- A truncated string that looks like a raw `agent_id` fragment is also rendering in the row.

Find every place `AgentListItem`/`AgentDetail`'s `client_name` and `agent_id` fields get interpolated directly into visible JSX in `components/device-card.tsx` and the devices list page/client component. Replace:
- Anywhere `client_name` is shown to identify "whose device this is" (relevant mainly in the staff/all-customers view) → use the customer's own `orgName` field (already on `User`, populated via onboarding/Settings per V2/V2.1) instead. You'll need to thread `orgName` through wherever the agent list is fetched for staff (`listAgents()` with no client filter) — this likely means joining against Vantra's own `User` table by matching `client_name` back to `vantra-{userId}` server-side (reversing the slug), not exposing the raw TRMM value to the client at all.
- Anywhere a raw `agent_id` is rendered as visible text (not just used internally as a React key or URL param, which is fine) → remove it. If some short reference is genuinely useful for support purposes, use a short suffix/hash of it rather than the raw value, or omit it entirely — use your judgment, the constraint is "no raw TRMM agent_id string as visible text."

## Part D — Relative last-seen timestamps

Every agent (`AgentListItem`/`AgentDetail`) already carries `last_seen` as an ISO string (confirmed live, no new TRMM call needed). Add a small formatting helper (e.g. `lib/relative-time.ts`, plain function, no new dependency needed — a hand-rolled "X minutes/hours/days ago" over the millisecond diff is enough, this doesn't need a library) and use it everywhere `last_seen` is currently rendered as a raw timestamp in the device list and device detail page.

## Part E — Idle-time display (needs a live TRMM check first — do not guess)

The user wants online devices to show idle status + idle duration in minutes, matching ScreenConnect's convention. **Before writing any UI for this**, do a live-verify pass against the real deployed TRMM API (same discipline as every other TRMM integration point in this codebase):
1. Check `GET /agents/{agent_id}/` (the existing `getAgentDetail` call) response on a real online test agent — does any field resemble idle time or last-input timestamp? Log the full raw response and inspect it; don't assume the field names in any doc.
2. If nothing obviously fits, check whether `send_raw_cmd`/PowerShell could derive it (e.g. querying `LASTINPUTINFO` via a small script) — but only pursue this if a direct API field truly isn't available, since a synchronous raw-command call per device in a list view has real latency/cost implications the user should probably approve before you build it that way.
3. Report back what you actually found (the real field name if one exists, or "not available directly, would require X" if not) rather than shipping a guess. If idle time isn't cheaply available, it's fine to skip this part and note it as a follow-up — don't fabricate a plausible-looking value.

## Part F — General device-list visual cleanup

Once Parts C–E land, do a pass on `components/device-card.tsx` / the devices list page styling with ScreenConnect's list view as the reference point: clear online/offline/idle grouping (already partially done per V2's online/offline sections — check idle fits into this grouping too once Part E's finding is known), clean rows, no leftover raw technical strings. This is a styling/layout pass on top of the already-corrected data from Parts C–E, not a new data-fetching change.

## Part G — Organization name placement

Per the user: the org name is currently squeezed in as a small subtitle "under the slash Vantra" in the header (`components/shell.tsx`/`components/dashboard-nav.tsx`, from V2.1's redesign). Give it a clearer, more prominent home — e.g. a distinct small "Organization" box/card in the sidebar or header area showing the org name on its own, rather than as a subtitle squeezed next to the product logo. Exact visual treatment is your call; the constraint is that it should read as its own labeled element, not a cramped inline subtitle.

## Verification

1. Services panel: confirm SpaceWorker now appears as a controllable row in `/admin101/vps`, confirm stop/start/restart actually work end-to-end (SpaceWorker goes down/comes back at `spaceworker.instaweb.top` when toggled), confirm the impact-copy note is accurate.
2. Platform status tiles: confirm both show correctly when both are up; manually stop SpaceWorker via the Services panel and confirm its tile flips to "down" within one refresh cycle, then restart it.
3. Device list: confirm no raw `client_name`/`agent_id` string is visible anywhere in either the customer view or the staff all-customers view — grep the rendered HTML output if needed to be sure, not just a visual glance.
4. Relative timestamps: confirm a device last seen a few minutes ago shows "X minutes ago" not a raw ISO string.
5. Idle time: either working correctly with a real verified field, or explicitly documented as skipped with the reason, per Part E.
6. Org name box: confirm it renders clearly and updates correctly after a Settings rename (existing `PATCH /api/settings` flow, unchanged).

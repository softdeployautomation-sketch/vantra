# Cline Task — Dashboard Visual Redesign, Part 1: Shell + Device List

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code (styling/layout), no data-fetching or API changes — the device list's real data (org name, relative timestamps, status grouping) is already correct per earlier work this session; this task is a visual pass on top of it.

**Design reference**: a Claude Design canvas covers the full visual direction — the dashboard/device-list page, a device detail page, and the Remote Tools "Control Console". Ask the user for the current canvas link if you don't have it.

Split into two parts so each stays a manageable size. This is Part 1 (shell + device list). Part 2 (`CLINE_TASK_DASHBOARD_VISUAL_REDESIGN_PART2.md`) covers the device detail page and Remote Tools — a separate task, no shared files, can be done in parallel by someone else.

## What already exists, don't rebuild it

- `components/shell.tsx` already has the header (logo, `ThemeToggle`, `LogoutButton`) and sidebar (`OrgSwitcher` + `DashboardNav`) — this task restyles it, doesn't restructure the auth/routing it depends on.
- `components/org-switcher.tsx`, `components/dashboard-nav.tsx` — real, working nav/org-switching logic. Don't touch the logic, only wrap it in the new visual treatment if the design calls for a different container/placement.
- `components/device-card.tsx` already correctly shows `device.orgName` (never a raw TRMM `client_name`), relative timestamps via `lib/relative-time.ts`, and status badges via `lib/agent-status.ts`. This task is a **layout/styling** pass on top of already-correct data — don't touch what data gets fetched or how it's shaped.

## What to build

1. **A static (non-animated) 3D-styled ambient background**, matching the design canvas's `VantraDashboard.dc.html` artboard: a device-network motif — small glowing node dots connected by thin lines — fixed at a real CSS `rotateX/rotateY` perspective angle (`transform-style: preserve-3d`), **no `@keyframes`, no animation, no JS**. Low opacity (roughly 0.5-0.6), sits behind the whole page as a `position: fixed` layer with a negative `z-index` (or an explicit higher `z-index` on the content wrapper — either approach works, just be internally consistent and confirm the background never paints over real content). This is a genuinely 3D-*looking* static image, not a flat gradient — the perspective/rotation is what gives it depth.
2. **A stats band** at the top of the device list (`app/dashboard/page.tsx` or wherever the device list currently starts) — hostname counts by status (Online/Offline/Overdue), styled as a real dashboard summary card, matching the design canvas's treatment. If a stats card doesn't already exist, this is new UI, not a data change — the counts come from the same device list data already being fetched, just aggregated client-side.
3. **Device list grouping/styling polish**: confirm the existing online/offline/overdue grouping (per earlier V2/V6 work) matches the design canvas's clean-row treatment — clear group headers with a colored status dot, tight consistent row height, no visual clutter. This is very likely mostly already correct; treat this as a verification-and-polish pass, not an assumption that everything needs rebuilding.
4. **Org name placement**: confirm the org switcher (already its own component in the sidebar) reads as a clearly labeled element, matching the design canvas's "Organization" box treatment — if it's already like this, nothing to do here.

## Explicitly not this task

- Device detail page, Remote Tools/Control Console — `CLINE_TASK_DASHBOARD_VISUAL_REDESIGN_PART2.md`.
- Any change to what data is fetched, `lib/agent-status.ts`, `lib/relative-time.ts`, or the underlying TRMM API calls — this task is styling only.
- Idle-time display — still an open item from earlier V6 work requiring a live TRMM API check that hasn't happened yet; don't guess a value, leave as-is if it's not already built.

## Verification

1. Load the dashboard, confirm the ambient background is genuinely static (no motion) but reads as three-dimensional (real perspective/depth from the CSS transforms, not a flat gradient).
2. Confirm the background never visually sits on top of real content (device rows, org switcher, nav all stay fully legible).
3. Confirm the stats band shows correct live counts matching the actual device list below it.
4. Confirm the device list still groups correctly (Online/Offline/Overdue) and no existing functionality (device links, group filters, search) regressed.

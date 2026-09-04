# Cline Task — Dashboard/device-detail density quick wins (from competitive research)

**Repo**: `/Users/mikeolab/vantra`. **Scope**: `components/dashboard-client.tsx`, `components/agent-detail-client.tsx` — UI only, no new TRMM permissions, no backend risk.

**Source**: `RESEARCH_RMM_COMPETITIVE_GAP_ANALYSIS.md` (already in this repo) — items 1, 2, 4, 5 from its prioritized gap list, all confirmed "quick win" / pure-UI-on-already-shipped-data. Read that file's §1–2 first for the full reasoning; this task doc is the concrete build spec derived from it.

## Why this matters

The product owner's own reaction after live-testing: the dashboard "looks empty and scanty." The research confirms this ISN'T because features are missing — multi-org, wallet billing, scripts, remote tools, tickets are all real and shipped. It's because the two screens a user looks at most (dashboard home, device Overview) are informationally thin compared to commercial RMMs, and some already-built capability (Task Manager, Services, Software) is buried three clicks deep in a Premium-gated panel where nobody finds it.

## What to build

1. **Dashboard home KPI row** — above the existing device list in `dashboard-client.tsx`, add a summary row: total devices / online count / offline count / open tickets / devices with failing checks. All of this data is already being fetched (`GET /api/devices` returns per-device status; `GET /api/tickets` returns tickets with status) — this is pure client-side aggregation, no new API calls.
2. **Overview tab enrichment** — `agent-detail-client.tsx`'s `OverviewPanel` currently renders 7 plain rows + a 4-tile check-count grid. Add rows for `total_ram` and `disks` — both fields are already typed in `lib/trmm.ts`'s `AgentDetail` interface (confirm the exact field names/shapes against one real `GET /api/devices/:id` response before wiring the UI, since they've never actually been rendered yet — don't assume the interface's typing is 100% accurate to the live payload without checking).
3. **"At a glance" strip on Overview** — a new lightweight summary widget (not the full management UI) showing: installed-software count, running-services count, and the single top process by CPU. The backend calls already exist and are wired (`getInstalledSoftware`, `listWindowsServices`, `listAgentProcesses` in `lib/trmm.ts`, each with a live API route) — call them here just for a read-only count/preview, keep the full management UI where it already lives (Backstage, Premium-gated). This is what lets a **free-tier** user see there's something to look at without needing Premium.
4. **Pull Task Manager / Services / Software out of "Backstage" into their own top-level device-detail tabs** — currently these three real, fully-wired panels only exist nested inside Remote Tools' Backstage sub-panel, which itself only shows for Premium users. Split them into their own tabs in `agent-detail-client.tsx`'s tabs array (alongside Overview / Scripts / Remote Tools), so someone evaluating "does this have patch/software management" can actually find it. Decide during implementation whether these three new tabs stay Premium-gated (matching Backstage's current gating) or become free-tier read-only with actions gated — the research report suggests the "free tier: view-only, no actions" pattern already used elsewhere in the app as the natural fit, but confirm this product decision with the user before changing any existing gating behavior, don't assume.

## Explicitly not this task

- **Failing-checks detail drill-down** (research item 3) — needs a TRMM permission grant (`can_list_checks`-equivalent) that hasn't happened yet; blocked until that's done separately, not part of this task.
- Alerts feed, software inventory as its own tab, action audit log, bulk actions (research items 6–9) — reasonable next batch, not this one.
- Patch management, monitoring-policy configuration (research items 10–11) — big builds needing their own TRMM permission grants and live-verification passes; explicitly out of scope here.
- Reporting/export, network-device monitoring (items 12–13) — backlog, not urgent.
- Recurring card billing, Mac/Linux installers (items 14–15) — already-made, already-correct product decisions; do not relitigate these.

## Verification

1. Load the dashboard, confirm the KPI row shows correct live counts matching what's actually in the device list below it.
2. Load a real device's Overview tab, confirm `total_ram`/`disks` render with real values (not "undefined" or a crash) — if the actual TRMM field names differ from what `lib/trmm.ts` currently types, fix the type to match reality, don't paper over a mismatch.
3. Confirm the "at a glance" strip shows real counts for a device with actual installed software/services, and that a free-tier account can see this strip without hitting a Premium gate.
4. Confirm Task Manager / Services / Software are now reachable as their own tabs, and that whatever gating decision was made (Premium vs free-view) is applied consistently across all three.

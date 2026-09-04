# Cline Task — Dashboard Visual Redesign, Part 2: Device Detail + Control Console

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code (styling/layout) only. No behavior changes — every piece of functionality referenced here (the 3 connect options, the post-connect Tools menu, tab order, reboot/shutdown/ping) is already built and working; this task is a visual polish pass to match the design canvas.

**Design reference**: `design/DeviceDetail.design.html` and `design/ControlConsole.design.html` in this repo — static HTML mockups, open directly in a browser (no login/canvas link needed).

Independent of `CLINE_TASK_DASHBOARD_VISUAL_REDESIGN_PART1.md` (the dashboard/device-list shell) — no shared files, can be done by someone else in parallel.

## What already exists, don't rebuild it

- `components/agent-detail-client.tsx` — the device detail page. Already has the header (hostname, status badge, agent id, Ping/Reboot/Shutdown with confirm dialogs) and a tab bar (Overview / Scripts / Remote Tools). The `OverviewPanel` sub-component already renders the exact real fields: Operating system, Monitoring type, Last seen, Logged in user, Public IP, Needs reboot, Description, plus a Monitoring-checks stat grid (Total/Passing/Warning/Failing). **This task restyles this existing structure, it does not add new fields or change what data is shown.**
- `components/remote-tools.tsx` — the Control Console. Already has: Terminal-first/Files-middle/Control-last tab order, a 3-option connect chooser on the Control tab ("Connect to device", "Connect with input suspended", "Connect to Backend" — this exact copy, verified against the real shipped file, don't reword it), a post-connect toolbar (mode indicator, "Open in new tab", a "Tools" dropdown menu, Disconnect), and the Tools menu's first two entries (input suspend/resume, maintenance screen start/stop). **All of this logic is done and correct** — this task is purely a visual pass matching the design canvas's card/spacing/color treatment, not new functionality.

## What to build

1. **Visual polish on the device-detail header and tabs** — match the design canvas's `DeviceDetail.dc.html` treatment: a clean header row (hostname + status badge + a monospace agent-id line), action buttons styled consistently with the rest of the app's button conventions, a tab bar with a clear active-state indicator (underline + tinted text, matching the design).
2. **Visual polish on `OverviewPanel`** — the device-info table and the monitoring-checks stat grid, matching the design canvas's card treatment (rounded card containers, consistent row dividers, the 4-stat grid with tinted backgrounds per status color — green/amber/red).
3. **Visual polish on the Control Console** (`remote-tools.tsx`'s Control tab) — the 3-option connect chooser as a set of clearly clickable cards (hover state, consistent spacing), the post-connect toolbar and Tools dropdown matching the design canvas's treatment. Confirm the exact real copy for the 3 connect options is preserved verbatim (don't paraphrase it during a styling pass).

## Explicitly not this task

- Dashboard/device-list shell, the ambient 3D background — `CLINE_TASK_DASHBOARD_VISUAL_REDESIGN_PART1.md`.
- Any change to the 3 connect options' actual behavior, the Tools menu's action list, reboot/shutdown/ping logic, or the tab-switching mechanism — all already correct, this task only touches visual presentation.
- The custom maintenance-overlay image upload feature — already built (`lib/maintenance-overlay.ts`), not part of this visual pass unless its own UI genuinely doesn't match the app's conventions (spot-check, don't assume work is needed here).

## Verification

1. Open a real device's detail page, confirm the header/tabs/Overview panel render correctly with no data regression (every field that showed before still shows, in the same place).
2. Open the Remote Tools tab, confirm all 3 connect options are still present with their exact original copy, confirm connecting to a real device still works end-to-end (this is a styling pass — if anything functional breaks, that's a bug introduced by this task, not something to work around).
3. Confirm the post-connect Tools menu still contains input-suspend/resume and maintenance-screen start/stop, and both still work.

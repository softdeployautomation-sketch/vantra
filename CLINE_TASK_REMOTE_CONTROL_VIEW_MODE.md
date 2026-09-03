# Cline Task — Remote Control View/Control Toggle + Multi-Tab Sessions

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code only, no VPS/infra changes needed for this task.

## Context

Remote Tools today (`components/remote-tools.tsx`) embeds a MeshCentral iframe for full remote-desktop control, plus a terminal/run-command panel — see `CLINE_TASK_BACKSTAGE_REMOTE_ADMIN.md` for the most recent additions there. The user asked for two behavior changes, confirmed directly with them (do not re-litigate these, they were ambiguous in an earlier draft and have now been explicitly clarified):

1. **The remote-desktop view should open in VIEW-ONLY mode by default** — the technician can see the customer's screen, but their mouse/keyboard input is NOT sent to the device. A menu/toolbar over the session provides a toggle to switch to full control when the technician actually needs to interact with the machine, and back again.
2. **A "blank guest screen for maintenance" option in that same menu is the existing V2 maintenance-overlay feature** (`lib/maintenance-overlay.ts`, `startMaintenanceOverlay`/`stopMaintenanceOverlay` — the Windows-Update-style dark screen with a spinner and "Working on updates / Don't turn off your computer" text, sent via `sendRawCmd` with `runAsUser: true`). It is not a new mechanism — this task just needs to make it reachable from this menu instead of wherever it currently is (if it isn't already exposed in the UI at all, this task is what exposes it for the first time).

Additionally: **each device's remote session should open in a new browser tab**, not navigate away from the current one, so a technician can have several devices' sessions open across multiple tabs and switch between them while doing maintenance.

## Part A — MeshCentral view-only vs. full-control

Check `getMeshCentralUrls`'s existing `control` URL (in `lib/trmm.ts`) and MeshCentral's own URL parameter scheme for the embedded viewer. MeshCentral's guest/viewer links support a read-only mode via URL parameters (the exact param is `viewonly=1` on modern MeshCentral builds, but **confirm this against the actual deployed MeshCentral version on this VPS before trusting it** — check `/meshcentral/meshcentral-data/config.json` or the MeshCentral admin UI for the version, and test the parameter live against a real connected test agent rather than assuming the param name/behavior from general knowledge, same discipline as every other MeshCentral/TRMM integration point in this project that turned out to need a live check).

Design:
1. Default: build the iframe `src` with the view-only parameter set, so a technician opening a session starts in view-only mode.
2. A small persistent toolbar/menu overlaid on (or positioned above) the iframe — reuse `components/modal.tsx`'s styling conventions or a simple fixed-position bar, whichever fits better once you see the layout — with a toggle button: "Enable full control" / "Switch to view-only". Toggling reloads the iframe `src` with the parameter flipped (MeshCentral doesn't support changing this on a live embedded session without reloading the frame, as far as is confirmed — verify this assumption live too, and if it turns out there's a way to switch without a reload, prefer that).
3. Make the current mode visually obvious at all times (e.g. a small badge: "View only" in neutral color vs. "Full control" in a warning/amber color, since full control is the more consequential state) — the technician should never be confused about which mode they're in before clicking on the customer's screen.

## Part B — Maintenance overlay menu entry

In the same toolbar/menu from Part A, add a "Start maintenance screen" / "Stop maintenance screen" toggle (mutually exclusive with itself — track whether it's currently running, likely via a simple state flag since `startMaintenanceOverlay`/`stopMaintenanceOverlay` per V2's design write a PID sidecar file on the agent for exactly this kind of start/stop tracking — check if a "is it currently running" query exists already; if not, track it client-side per session as a reasonable v1 and note the limitation, since a page refresh would lose that tracked state until this is hardened later).

Wire this to the existing `app/api/devices/[agentId]/maintenance-overlay/route.ts` route from V2 if it exists and works; if V2's plan describes this route but it was never actually built/wired to any UI, build the thin API call now (the underlying `lib/maintenance-overlay.ts` logic should already exist per V2 — check before rewriting it).

**Reminder from V2's own design notes, still true**: this only covers the primary monitor and does not block keyboard/mouse input on the customer's end (that would need a compiled low-level Windows hook, explicitly out of scope) — don't let the UI copy imply stronger guarantees than that.

## Part C — Multi-tab sessions

Find wherever a device's Remote Tools / screen session is currently launched (a link, button, or in-page navigation into the device detail page's Remote Tools tab). Change it so opening a remote session happens via `target="_blank"` with `rel="noopener noreferrer"` (a plain anchor tag, or `window.open(url, "_blank", "noopener,noreferrer")` if it's currently a JS-driven navigation rather than a real link) — so clicking into a device's remote session opens a new tab rather than replacing the current one. This should be a small, contained change once Parts A/B are otherwise in place; do this part last since it's low-risk and easy to verify in isolation.

## Verification

1. Open a Remote Tools session on a real connected test agent: confirm it starts in view-only mode (moving the mouse/typing in the embedded frame does NOT move the cursor or type on the real device).
2. Toggle to full control: confirm input now does reach the device. Toggle back to view-only: confirm input stops reaching it again.
3. Confirm the current mode is visually unambiguous at every point (no state where it's unclear which mode is active).
4. Start the maintenance overlay from the new menu entry: confirm the real Windows Update-style screen appears on the test agent's primary monitor. Stop it: confirm it closes cleanly.
5. Confirm opening a device's remote session opens a new browser tab, and confirm two devices' sessions can be open in two tabs simultaneously without either interfering with the other (independent MeshCentral connections).
6. Regression: confirm the existing terminal/run-command panel and Backstage sub-section (if already built per `CLINE_TASK_BACKSTAGE_REMOTE_ADMIN.md`) still work unaffected by these changes.

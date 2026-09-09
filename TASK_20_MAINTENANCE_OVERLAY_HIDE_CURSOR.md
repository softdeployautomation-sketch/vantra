# Task 20 — Hide the mouse cursor from the local screen during the maintenance overlay

**Status: ready to implement.** Written 2026-09-09 after a live test of Task 19 (confirmed working — the technician's KVM view correctly shows the real desktop, not the overlay) surfaced a separate, real issue: the technician's own mouse movement is visible to the person physically at the machine, moving on top of the "Working on updates" overlay.

## Why this happens (different mechanism from Task 19 — don't conflate them)

Task 19's `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` only affects whether a *window's rendered contents* show up in `BitBlt`/`PrintWindow`-based screen capture. It has nothing to do with the mouse cursor. When a technician moves their mouse during a "Full control" Remote Tools session, the agent injects a real mouse-move on the target machine (`SendInput`/equivalent) — Windows renders the cursor at the very top of the entire display composite, above every window including one marked `WDA_EXCLUDEFROMCAPTURE`. So the overlay correctly hides itself from the technician's *own* capture, but the technician's cursor movement is still fully visible to the person physically at the screen, which breaks the "an automatic update is running, nothing else is happening" illusion the overlay exists for.

## The fix

WinForms has a built-in invisible cursor: `[System.Windows.Forms.Cursors]::None`. Since the overlay form is already full-screen (`WindowState = 'Maximized'`) and topmost (`TopMost = $true`), setting the form's own `Cursor` property to this hides the pointer for as long as it's within the overlay's bounds — which, being full-screen, is effectively always, for the duration the overlay is up.

**This only affects what's rendered on the target machine's own physical display.** The technician's cursor in their own Remote Tools browser view is entirely client-side and completely unaffected — this task is scoped purely to what the person physically at the machine sees.

### Exact change, in `lib/maintenance-overlay.ts`

Add one line to both `GUI_SCRIPT` and `customGuiScript()`, right after the existing `$form.BackColor = [System.Drawing.Color]::Black` line (same spot in both — that's the last of the existing `$form.*` property assignments before the controls/`Add_Shown` block begins):

```powershell
$form.Cursor = [System.Windows.Forms.Cursors]::None
```

That's the entire change — one line, in the two places `$form.BackColor = [System.Drawing.Color]::Black` already appears (confirmed present in both `GUI_SCRIPT` and `customGuiScript()`'s templates). No new P/Invoke, no new `Add-Type`, nothing else to wire up.

## Explicitly out of scope

- Not attempting to hide/suppress the cursor system-wide via `ShowCursor()` or a low-level mouse hook — that's a per-thread global counter that doesn't reliably interact with cursor movement injected by a different process (MeshAgent's own input-injection), and is unnecessary complexity when the simple per-window `Cursor = None` approach directly solves what's actually being asked (hide it from the local display while the overlay's own window is what's covering the screen).
- Not touching Task 19's `DISPLAY_AFFINITY_PINVOKE` constant, the `Add_Shown` blocks, or any capture-related logic — this is a separate, unrelated single-line addition.
- Not touching the technician-side experience at all — their cursor rendering happens entirely in their own browser and is untouched by anything on the target machine.

## Verification

1. `npx tsc --noEmit` + `npm run build` clean (this is a plain string literal addition, should have zero effect on either).
2. Live test on a real Windows agent (same setup as Task 19's verification): start the overlay, connect via Remote Tools "Connect to device," move the mouse as the technician, and confirm the cursor is **not visible on the target machine's own physical/virtual display** while it remains fully visible and functional in the technician's own browser view.
3. Confirm stopping the overlay (`stopMaintenanceOverlay`) still correctly restores normal cursor behavior once the overlay window closes (this should be automatic — the cursor override only applies while this specific form exists — but confirm rather than assume, matching this file's own established live-test discipline).
4. Repeat for both the default overlay and the custom-image overlay path — both need the fix and both need their own check.

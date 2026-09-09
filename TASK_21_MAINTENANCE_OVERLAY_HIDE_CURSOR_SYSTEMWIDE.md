# Task 21 — Hide the cursor system-wide, not per-window (Task 20 follow-up)

**Status: ready to implement.** Written 2026-09-09 after Task 20's fix (`$form.Cursor = [System.Windows.Forms.Cursors]::None`) was live-tested and confirmed to NOT work — the user reported the cursor still visibly moves on top of the overlay on the target machine's own physical screen.

## Why Task 20 didn't work (confirmed from real MeshAgent source, not assumed)

Re-checked both relevant MeshAgent source files directly:

- `meshcore/KVM/Windows/tile.cpp` (screen **capture**, technician's side): confirmed lines ~511-524 call `GetCursorInfo()` + `DrawIconEx()` to manually draw the cursor into every captured frame. This is a *separate, explicit compositing step*, independent of any window's own rendering — and it's only needed at all because a plain `BitBlt` capture (what this file uses) does **not** naturally pick up the cursor, since real Windows cursors are rendered by DWM as a system-wide hardware overlay plane sitting on top of every window, not blitted into any window's own client area.
- `meshcore/KVM/Windows/input.c` (mouse **injection**, what happens when a technician moves their mouse remotely): confirmed `MouseAction()` (line 392) only calls `SendInput()` with `MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`. No `SetCursor`, no `ShowCursor`, nothing that forces a cursor to appear. MeshAgent itself does nothing to make the local cursor visible.

Putting these together: the cursor the person physically at the machine sees is the **normal Windows/DWM hardware cursor overlay**, driven by whatever `SetCursor()` handle is currently active — the exact same overlay `tile.cpp` has to manually re-draw because it sits outside normal window rendering. `Form.Cursor = Cursors.None` only asks *our specific window* to request a blank cursor via the `WM_SETCURSOR` negotiation. That's a real, normally-working technique, but it's per-window and message-based — it does not reliably override the system-wide overlay against synthetic, remote-injected mouse movement the way it would for a normal foreground desktop app.

**The fix that actually operates at the right level**: `SetSystemCursor()` — a Win32 API that swaps the *actual system cursor resources* (all of them, by ID) for the current desktop session, exactly like a kiosk-mode app would. This isn't a window asking politely; it replaces what DWM has to draw with, system-wide, for as long as the override is in place.

## The fix

### 1. New shared P/Invoke block, `CURSOR_HIDE_PINVOKE`, in `lib/maintenance-overlay.ts`

Add this as a new constant right after the existing `DISPLAY_AFFINITY_PINVOKE` constant (same file, same pattern):

```ts
const CURSOR_HIDE_PINVOKE = String.raw`Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VantraCursor {
    [DllImport("user32.dll")]
    public static extern bool SetSystemCursor(IntPtr hcur, uint id);
    [DllImport("user32.dll")]
    public static extern IntPtr CopyIcon(IntPtr hIcon);
    [DllImport("user32.dll")]
    public static extern IntPtr CreateCursor(IntPtr hInst, int xHotSpot, int yHotSpot, int nWidth, int nHeight, byte[] pvANDPlane, byte[] pvXORPlane);
}
"@

function Hide-SystemCursor {
  # 32x32 monochrome cursor, AND-mask all 1s + XOR-mask all 0s = fully transparent
  # (standard "invisible cursor" trick). 32 px / 8 bits-per-byte * 32 rows = 128 bytes/plane.
  $and = [byte[]](, 0xFF * 128)
  $xor = [byte[]](, 0x00 * 128)
  $blank = [VantraCursor]::CreateCursor([IntPtr]::Zero, 0, 0, 32, 32, $and, $xor)
  # every OCR_* system cursor id (normal, ibeam, wait, cross, up, size*, icon, no, hand, appstarting)
  $ids = 32512,32513,32514,32515,32516,32640,32641,32642,32643,32644,32645,32646,32648,32649,32650
  foreach ($id in $ids) {
    # SetSystemCursor takes ownership of (and destroys) the handle it's given —
    # each of the 15 slots needs its own copy of the blank cursor.
    $copy = [VantraCursor]::CopyIcon($blank)
    [VantraCursor]::SetSystemCursor($copy, $id) | Out-Null
  }
}
`;
```

### 2. Call `Hide-SystemCursor` from both GUI scripts' `Add_Shown` blocks

In both `GUI_SCRIPT` and `customGuiScript()`:
- Add `${CURSOR_HIDE_PINVOKE}` right after `${DISPLAY_AFFINITY_PINVOKE}` (same spot both currently interpolate the display-affinity block — near the top, after the two `Add-Type -AssemblyName` lines).
- Add `Hide-SystemCursor` as a new line inside the existing `$form.Add_Shown({ ... })` block, alongside the existing `[VantraDisplayAffinity]::SetWindowDisplayAffinity(...)` call (order between the two doesn't matter — same block, same discipline as Task 19/20).
- **Remove** the now-superseded `$form.Cursor = [System.Windows.Forms.Cursors]::None` line from both scripts (it's harmless to leave, but it's dead weight now that the real fix is system-wide — remove it rather than stacking an ineffective line on top of a working one).

### 3. CRITICAL — restore cursors in `stopCommand()`, not inside the GUI script

`SetSystemCursor` is a **persistent, OS-level change for the entire login session** — it is NOT automatically undone when the process that called it exits or is killed. `stopMaintenanceOverlay()` calls `stopCommand()`, which force-kills the overlay process via `Stop-Process -Force` — a forceful kill runs none of that process's own cleanup code. **If cursor restoration isn't added directly into `stopCommand()`, stopping the overlay will leave the target machine's cursor invisible system-wide until the next reboot or logoff.** This is the one part of this task that must not be skipped or gotten wrong.

Add a second, tiny P/Invoke block used only by `stopCommand()` (it's a separate standalone script from the GUI one, sent via its own `sendRawCmd` call, so it needs its own `Add-Type`):

```ts
const CURSOR_RESTORE_SNIPPET = String.raw`Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VantraCursorRestore {
    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
}
"@
[VantraCursorRestore]::SystemParametersInfo(0x0057, 0, [IntPtr]::Zero, 0) | Out-Null
`;
```

(`0x0057` is `SPI_SETCURSORS` — a single call that resets *all* system cursors back to the user's normal registry-configured defaults, simpler and safer than tracking/restoring each of the 15 individual cursor IDs by hand.)

Add this snippet's content as the **first** lines returned by `stopCommand()` (prepend to the existing joined-lines array, before the `$dir = ...` line) — it should run unconditionally every time `stopMaintenanceOverlay` is called, regardless of whether a PID file exists or a process is actually found, since the whole point is to guarantee restoration.

### 4. Explicitly out of scope

- No changes to `startMaintenanceOverlay`/`stopMaintenanceOverlay`'s exported signatures, `runAsUser: true`, timeouts, or the launcher/PID-file mechanism — this task only touches the GUI script bodies and `stopCommand()`'s body.
- No changes to Task 19's display-affinity logic — leave `DISPLAY_AFFINITY_PINVOKE` and its call untouched, just add the cursor block alongside it.
- Not attempting to hide the cursor only *while it's over the overlay's bounds* (a more surgical, per-region approach) — the overlay is already full-screen/maximized, so a system-wide hide during its lifetime is equivalent in practice and far simpler/more robust than trying to re-litigate per-window cursor negotiation a second time.

## Verification (live test required — do not consider this done from code review alone)

Same discipline as Tasks 19/20 — this is a live-executing GUI/OS-level change with a real regression risk if step 3 above is wrong.

1. `npx tsc --noEmit` + `npm run build` clean.
2. Start the overlay on the real Windows test agent. Confirm the cursor is **not visible at all** on the target machine's own physical/virtual display, including while a technician is connected via Remote Tools and moving their mouse remotely.
3. **Stop the overlay, then immediately move the physical mouse (or check via the technician's own KVM view) and confirm the normal arrow cursor is visible again** — this is the single most important check in this task, given the persistent/session-wide nature of the change. If the cursor stays hidden after stop, do not consider this task done — that's a worse regression than Task 20's original no-op.
4. Repeat both the show and stop checks for the custom-image overlay path (`customGuiScript`), not just the default one.
5. As a belt-and-suspenders sanity check, log off and back on (or reboot) the test VM once at the end of this task's testing, confirm cursors are still normal — this should already be guaranteed by step 3, but costs nothing to confirm given how disruptive it would be to get wrong on a real customer machine.

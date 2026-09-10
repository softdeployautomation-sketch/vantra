# Task 23 — Make the overlay click-through, so the technician's real clicks reach the real desktop

**Status: ready to implement. Do this FIRST, before Task 22.** Written 2026-09-10 after the user corrected an earlier report: going all the way back to the very first Task 19 test, the technician's remote mouse never actually clicked anything — it only visibly moved. This was wrongly attributed to the later cursor-hide work (Tasks 20/21); it's actually been broken since Task 19's first deployment, for a completely different, more fundamental reason.

## The actual bug (a real gap in Task 19's own design, not anything cursor-related)

`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` (Task 19) does exactly one thing: excludes a window from `BitBlt`/`PrintWindow`-style screen *capture*. It has zero effect on that window's normal Z-order or input hit-testing. The overlay is still a real, topmost, full-screen window sitting above everything else for the purposes of "which window does a click at this screen coordinate go to."

So the actual sequence during a session is: the technician sees the real desktop (correctly, thanks to capture exclusion) and clicks on something they see there — but the real, system-level click (whether from real hardware or MeshAgent's `SendInput`) is delivered to **whatever window is topmost at that screen point**, which is our own overlay form, not the real desktop underneath. Our overlay has no click handling on it at all (it's just a `PictureBox`/`Label`/`ProgressBar` display), so the click simply does nothing. The cursor still visibly moves because cursor rendering is a separate, Z-order-independent system compositing step — completely disconnected from which window actually receives the click.

**This has nothing to do with `SetSystemCursor`, `Hide-SystemCursor`, or anything from Tasks 20/21/22.** Those are correctly reverted/on hold for unrelated reasons. This is a standalone, more fundamental gap that's been present since Task 19 shipped.

## The fix: `WS_EX_TRANSPARENT`

A window with the extended style `WS_EX_TRANSPARENT` (`0x00000020`) is excluded from mouse hit-testing — Windows passes clicks straight through it to whatever's underneath, while the window keeps rendering normally and keeps its Z-order/topmost status for *display* purposes. This is the standard, long-established technique for exactly this kind of "visible overlay that doesn't intercept input" requirement (used by screen-annotation tools, click-through HUDs, etc.) — a completely different Windows mechanism from display affinity, hooks, or cursor resources.

Since window style bits (`GWL_EXSTYLE`) are always 32-bit regardless of process architecture, the plain (non-Ptr) `GetWindowLong`/`SetWindowLong` are correct and sufficient here — no need for the `GetWindowLongPtr`/`SetWindowLongPtr` 64-bit variants, which only matter for pointer-sized values like `GWL_WNDPROC`.

### Exact change, in `lib/maintenance-overlay.ts`

New P/Invoke constant, alongside `DISPLAY_AFFINITY_PINVOKE`:

```ts
const CLICK_THROUGH_PINVOKE = String.raw`Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VantraClickThrough {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TRANSPARENT = 0x00000020;
}
"@`;
```

In both `GUI_SCRIPT` and `customGuiScript()`:
- Interpolate `${CLICK_THROUGH_PINVOKE}` alongside `${DISPLAY_AFFINITY_PINVOKE}` (same spot, after the `Add-Type -AssemblyName` lines).
- Inside the existing `$form.Add_Shown({...})` block, add (order relative to the display-affinity call doesn't matter, but logically pair them since both configure the window's special behavior at the same point):

```powershell
$exStyle = [VantraClickThrough]::GetWindowLong($form.Handle, [VantraClickThrough]::GWL_EXSTYLE)
[VantraClickThrough]::SetWindowLong($form.Handle, [VantraClickThrough]::GWL_EXSTYLE, ($exStyle -bor [VantraClickThrough]::WS_EX_TRANSPARENT)) | Out-Null
```

## A known, separate side effect to flag, not to fix in this task

Click-through only affects **mouse** hit-testing. Keyboard focus/activation is a different Windows mechanism — since the overlay is shown via `$form.ShowDialog()` (modal, activates the window), it likely still holds keyboard focus even once mouse clicks pass through it. That means keystrokes the technician sends might still go nowhere (absorbed by our unfocusable-control-less form) rather than reaching whatever real application now receives the passed-through mouse clicks. **This task is scoped to fixing mouse clicks only** — note whether this keyboard gap actually shows up during the live test below, and if so, treat it as a follow-up task (likely `WS_EX_NOACTIVATE` or switching from `ShowDialog()` to a non-activating show pattern), not something to guess a fix for preemptively here.

## Why this must be tested and confirmed BEFORE Task 22

Task 22 (local-input-block + cursor-hide via `SetCursor`) is built on the assumption that letting "injected" mouse events through the low-level hook is sufficient for the technician's clicks to work. If clicks are still being swallowed by the overlay's own hit-testing (this task's bug), Task 22 could look like it's failing when the actual cause is this separate, more fundamental issue — exactly the kind of compounding-changes problem this whole investigation has already run into once. Ship and verify this alone first.

## Explicitly out of scope

- No changes to Task 19's display-affinity code, or anything from Tasks 20/21 (already reverted) or Task 22 (not yet implemented, sequenced after this).
- Not fixing the keyboard-focus gap noted above pre-emptively — observe first, fix separately if confirmed real.

## Verification (live test required)

1. `npx tsc --noEmit` + `npm run build` clean.
2. Start the overlay on the real Windows test agent, connect as the technician with Full Control.
3. **The core test**: click on something real on the desktop that the technician can see through the (capture-excluded) overlay — e.g., open Start menu, click a taskbar icon, interact with an actual open window. Confirm the click actually registers on the real desktop now, not just cursor movement.
4. Confirm the overlay still visually covers the screen correctly for the local physical user (click-through must not make it visually transparent too — those are different concerns; the overlay should still look exactly like it did before, just not intercept clicks).
5. Note whether keyboard input (typing) works or not, per the caveat above — report this explicitly either way rather than assuming.
6. Repeat for the custom-image overlay path.
7. Only once this is confirmed working should Task 22 be attempted next.

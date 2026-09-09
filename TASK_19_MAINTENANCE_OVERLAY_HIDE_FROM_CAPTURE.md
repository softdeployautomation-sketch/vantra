# Task 19 — Exclude the maintenance overlay from the technician's own remote view

**Status: ready to implement, needs a live test before considered done.** Written 2026-09-09 after researching MeshAgent's actual screen-capture source (confirmed live on GitHub, not guessed) to answer whether a "local user sees a cover screen, technician still sees the real desktop" workflow is achievable.

## The gap this closes

The maintenance overlay (`lib/maintenance-overlay.ts`, already shipped) shows a full-screen WinForms window on the guest's machine — either the default Windows-Update look or a custom uploaded image. As built today, this window is a completely normal window with no special handling — which means if a technician is *also* connected via Remote Tools' KVM view (`components/remote-tools.tsx`'s Control tab) while the overlay is running, **the technician's own remote screen would show the same overlay covering everything**, not the real desktop underneath. That defeats the actual point of the feature (cover the screen for the person physically at the machine while a technician keeps working).

## Why this is fixable, and how (confirmed from real source, not assumed)

Read MeshAgent's actual Windows capture implementation directly: `meshcore/KVM/Windows/tile.cpp` in `Ylianst/MeshAgent` (the real agent binary source — confirmed Apache 2.0, same as the MeshCentral server). Its screen capture is classic GDI: `BitBlt`/`GetDIBits` against the desktop device context. Confirmed via `grep` against the real file — no DXGI/Desktop Duplication path is active (that code exists in the file but is entirely commented out).

Windows has a documented API built specifically to hide a window from exactly this class of capture: **`SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`** (`user32.dll`). A window marked this way renders normally on the physical monitor for anyone sitting at the machine, but comes back black/excluded to any `BitBlt`/`PrintWindow`-based capture — which is exactly what MeshAgent's KVM uses. This is a real, stable, documented Windows behavior (Windows 10 2004+), not a hack specific to this agent.

**This does not require the Mesh/MeshAgent fork at all.** It's a small addition to the existing PowerShell overlay scripts already shipped, using P/Invoke to call the Win32 API from WinForms — testable immediately, independent of the fork/sandbox timeline in `PLAN_MESH_FORK.md`.

## The exact change

Add a shared PowerShell snippet that both `GUI_SCRIPT` and `customGuiScript()` in `lib/maintenance-overlay.ts` include, right after the existing `Add-Type -AssemblyName System.Windows.Forms` / `System.Drawing` lines:

```powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VantraDisplayAffinity {
    [DllImport("user32.dll")]
    public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
}
"@
```

Then, inside the existing `$form.Add_Shown({ ... })` block (both scripts already have one — this is where the form's window handle is guaranteed to exist), add:

```powershell
[VantraDisplayAffinity]::SetWindowDisplayAffinity($form.Handle, 0x11) | Out-Null
```

`0x11` is `WDA_EXCLUDEFROMCAPTURE` (17 decimal) — the documented Microsoft constant. `WDA_NONE` is `0`, `WDA_MONITOR` is `1`; don't confuse these, `0x11` is the specific "actually excluded from capture" value, not `WDA_MONITOR`.

### Concretely, in `lib/maintenance-overlay.ts`:

- **`GUI_SCRIPT`** (the default Windows-Update-style overlay, lines ~101-158): add the `Add-Type` P/Invoke block right after the two existing `Add-Type -AssemblyName ...` lines, and add the `SetWindowDisplayAffinity` call as the *first* line inside the existing `$form.Add_Shown({ param($s, $e) ... })` block (before the centering logic already there — order between the two doesn't matter, just needs to be inside `Add_Shown`).
- **`customGuiScript(ext: string)`** (lines ~53-91): same two additions, in the same two places (after the `Add-Type -AssemblyName` lines, and as the first line of its own `$form.Add_Shown({...})` block).
- Since both scripts need the identical P/Invoke block, factor it into one shared constant (e.g. `const DISPLAY_AFFINITY_PINVOKE = ...`) and reference it in both template strings, rather than duplicating the literal text — keeps the two scripts from drifting if this ever needs a second field/method added later.

## Explicitly not in scope for this task

- No changes to `lib/trmm.ts`, `sendRawCmd`, the launcher/stop command logic, or the API routes (`app/api/devices/[agentId]/maintenance-overlay`) — this is purely additive inside the two GUI script template strings.
- No changes to the Mesh/MeshAgent fork or sandbox — unrelated, this ships independently.
- Not attempting the DXGI/Desktop Duplication path or anything about *how* MeshAgent captures — the fix works precisely because that capture path is confirmed-inactive and the active one is BitBlt-based, which is what `WDA_EXCLUDEFROMCAPTURE` is designed to defeat. If MeshAgent's capture method ever changes (e.g., a future MeshAgent version switches to Desktop Duplication/DXGI), this specific technique would need re-verifying — not a concern today since we're pinned to a known version, but worth a comment noting the dependency.

## Verification (live test required — do not consider this done from code review alone)

This is a GUI-affecting, live-executing script change, same discipline as every other item in this file's own existing "LIVE-TEST ITEMS" comments (the PictureBox/SizeMode and animated-GIF notes already there). On a real Windows test agent:

1. Start the maintenance overlay (`POST /api/devices/[agentId]/maintenance-overlay`, `action: "start"`) against a device that also has an active Remote Tools "Connect to device" KVM session open.
2. Confirm the overlay is visible on the actual device's physical/virtual display (e.g., via a screenshot taken locally on that machine, or by RDP-ing into it directly outside of Mesh).
3. **Confirm the technician's Mesh KVM view does NOT show the overlay** — it should show the real desktop underneath, unaffected.
4. Confirm `Stop-Process`/the existing stop flow still correctly kills the overlay window regardless of the display-affinity flag (it shouldn't interact with process termination at all, but verify rather than assume).
5. Repeat for the custom-image overlay path (`customGuiScript`), not just the default one — both need the same fix and both need their own verification pass.
6. If step 3 doesn't hold (technician's view still shows the overlay), stop and report the exact observed behavior rather than guessing a second fix — this would mean either MeshAgent's real capture path differs from what the source review found, or the flag isn't being applied before the frame is captured, both of which need a fresh look at real evidence rather than another blind attempt.

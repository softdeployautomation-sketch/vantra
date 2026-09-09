# Task 22 — Block only the local user's real mouse/keyboard, not the technician's remote input

**Status: ready to implement.** Written 2026-09-09. Ship and test independently of Task 21's cursor-hide fix (already re-deployed separately) so a regression is attributable to one change at a time.

## Why this exists, and why the obvious answer (MeshCentral's native "Remote Input Lock") doesn't work

The actual goal: while the maintenance overlay is up, the person physically at the machine should not be able to move the mouse or type, while the technician's own remote control keeps working normally.

MeshCentral's own desktop toolbar already has a "Remote Input Lock" button (`deskInputLockFunction()` in its view source, calling `desktop.m.SendRemoteInputLock(1)`), which on the agent side (`meshcore/KVM/Windows/kvm.c`, `MNG_KVM_INPUT_LOCK` handler) calls the real Win32 `BlockInput()` API. Microsoft's own docs for `BlockInput` state that "the thread that is blocking input can affect [key state] by calling SendInput. No other thread can do this" — which suggested MeshAgent's own remote-input thread might stay exempt while local hardware got blocked.

**Live-tested and confirmed this is not what happens**: toggling MeshCentral's Remote Input Lock button blocks the technician's own remote clicks too — it behaves identically to Vantra's existing client-side "Suspend/Resume input" toggle, not a local-only lock. Whatever thread MeshAgent's `BlockInput` call runs on, it evidently isn't the same one doing the technician's `SendInput` calls, so the documented same-thread exemption doesn't apply here. This path is closed — don't revisit `BlockInput`/MeshCentral's native input-lock for this goal.

## The mechanism that actually makes the real distinction

Windows tags every synthetic input event generated via `SendInput` with an `INJECTED` flag, distinct from genuine hardware input — this is a *per-event* marker, not a thread-scoped permission, so it doesn't depend on which thread/process generated it:

- Mouse events: `MSLLHOOKSTRUCT.flags` bit `LLMHF_INJECTED` (`0x01`), plus `LLMHF_LOWER_IL_INJECTED` (`0x02`) for input injected from a lower-integrity-level process.
- Keyboard events: `KBDLLHOOKSTRUCT.flags` bit `LLKHF_INJECTED` (`0x10`), plus `LLKHF_LOWER_IL_INJECTED` (`0x20`).

A low-level hook (`WH_MOUSE_LL` = 14, `WH_KEYBOARD_LL` = 13, installed via `SetWindowsHookEx`) sees every mouse/keyboard event system-wide before any application does, and can swallow it (return a nonzero value, without calling `CallNextHookEx`) or pass it through (`CallNextHookEx`). Checking the injected flag lets it block exactly the real local hardware input and nothing else — MeshAgent's own `SendInput`-driven remote clicks (which set this flag) pass through untouched, regardless of which process/thread MeshAgent uses internally.

**Why this is safer than Task 21's `SetSystemCursor` approach**: hooks installed via `SetWindowsHookEx` are automatically removed by Windows the instant the owning process exits — including a forced kill (`Stop-Process -Force`, exactly how `stopCommand()` already works). Unlike `SetSystemCursor` (a persistent, session-wide resource change that needed an explicit restore call), there is no "stuck blocked forever" failure mode to guard against here — no stop-side cleanup code is required for correctness, though the implementation below still includes an explicit unhook for the graceful-shutdown case as good practice.

## The exact change, in `lib/maintenance-overlay.ts`

### 1. New P/Invoke + hook-install function, `INPUT_BLOCK_PINVOKE`

Add as a new constant alongside `DISPLAY_AFFINITY_PINVOKE`/`CURSOR_HIDE_PINVOKE`:

```ts
const INPUT_BLOCK_PINVOKE = String.raw`Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VantraInputBlock {
    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT {
        public int ptX; public int ptY;
        public uint mouseData; public uint flags; public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT {
        public uint vkCode; public uint scanCode; public uint flags; public uint time;
        public IntPtr dwExtraInfo;
    }

    public const int WH_MOUSE_LL = 14;
    public const int WH_KEYBOARD_LL = 13;
    public const uint LLMHF_INJECTED_MASK = 0x03; // LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED
    public const uint LLKHF_INJECTED_MASK = 0x30; // LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED
}
"@

# IMPORTANT: the hook delegates MUST live in script-scope variables for as long
# as the hook is installed. If a delegate is only ever referenced inline / goes
# out of scope, .NET's garbage collector can free it while the hook is still
# registered — the next real input event then invokes a dangling callback
# pointer, which crashes the process. $script:-scoped variables here are load
# bearing, not stylistic.
$script:vantraMouseHookDelegate = $null
$script:vantraKeyboardHookDelegate = $null
$script:vantraMouseHookHandle = [IntPtr]::Zero
$script:vantraKeyboardHookHandle = [IntPtr]::Zero

function Block-LocalInput {
  $script:vantraMouseHookDelegate = [VantraInputBlock+HookProc] {
    param($nCode, $wParam, $lParam)
    if ($nCode -ge 0) {
      $info = [System.Runtime.InteropServices.Marshal]::PtrToStructure($lParam, [type][VantraInputBlock+MSLLHOOKSTRUCT])
      $injected = ($info.flags -band [VantraInputBlock]::LLMHF_INJECTED_MASK) -ne 0
      if (-not $injected) { return [IntPtr]1 }
    }
    return [VantraInputBlock]::CallNextHookEx([IntPtr]::Zero, $nCode, $wParam, $lParam)
  }
  $script:vantraKeyboardHookDelegate = [VantraInputBlock+HookProc] {
    param($nCode, $wParam, $lParam)
    if ($nCode -ge 0) {
      $info = [System.Runtime.InteropServices.Marshal]::PtrToStructure($lParam, [type][VantraInputBlock+KBDLLHOOKSTRUCT])
      $injected = ($info.flags -band [VantraInputBlock]::LLKHF_INJECTED_MASK) -ne 0
      if (-not $injected) { return [IntPtr]1 }
    }
    return [VantraInputBlock]::CallNextHookEx([IntPtr]::Zero, $nCode, $wParam, $lParam)
  }
  $script:vantraMouseHookHandle = [VantraInputBlock]::SetWindowsHookEx([VantraInputBlock]::WH_MOUSE_LL, $script:vantraMouseHookDelegate, [IntPtr]::Zero, 0)
  $script:vantraKeyboardHookHandle = [VantraInputBlock]::SetWindowsHookEx([VantraInputBlock]::WH_KEYBOARD_LL, $script:vantraKeyboardHookDelegate, [IntPtr]::Zero, 0)
}

function Unblock-LocalInput {
  if ($script:vantraMouseHookHandle -ne [IntPtr]::Zero) {
    [VantraInputBlock]::UnhookWindowsHookEx($script:vantraMouseHookHandle) | Out-Null
    $script:vantraMouseHookHandle = [IntPtr]::Zero
  }
  if ($script:vantraKeyboardHookHandle -ne [IntPtr]::Zero) {
    [VantraInputBlock]::UnhookWindowsHookEx($script:vantraKeyboardHookHandle) | Out-Null
    $script:vantraKeyboardHookHandle = [IntPtr]::Zero
  }
}
`;
```

### 2. Wire into both GUI scripts

In both `GUI_SCRIPT` and `customGuiScript()`:
- Interpolate `${INPUT_BLOCK_PINVOKE}` alongside the other two P/Invoke blocks (same spot, after `${DISPLAY_AFFINITY_PINVOKE}`/`${CURSOR_HIDE_PINVOKE}`).
- Call `Block-LocalInput` inside the existing `$form.Add_Shown({...})` block, alongside the display-affinity and cursor-hide calls (order among the three doesn't matter).
- Call `Unblock-LocalInput` inside the existing `$form.Add_FormClosing({...})` handler, **before** the `$e.Cancel = $true` line that deters casual Alt+F4 — this is belt-and-suspenders for the rare case the form does get a real close request (e.g. a future code path that actually allows closing); the real safety net remains that `Stop-Process -Force` auto-removes the hooks regardless, per the "why this is safer" section above.

### 3. No changes needed to `stopCommand()`

Unlike Task 21's `CURSOR_RESTORE_SNIPPET`, this task needs no restore step in the stop command — Windows removes a process's hooks automatically on exit, forced or not. Do not add one; it would be dead code.

## Explicitly out of scope

- Not touching Task 21's cursor-hide code (`CURSOR_HIDE_PINVOKE`, `Hide-SystemCursor`) or Task 19's display-affinity code — this is a third, independent P/Invoke block interpolated alongside the existing two, not a modification of either.
- Not attempting to use MeshCentral's native "Remote Input Lock" feature for this — confirmed live not to do what's needed (see above).
- Not blocking touch/pen input as a separate input class — synthetic touch/pen input that Windows translates to mouse messages already carries the same injected-flag semantics through `WH_MOUSE_LL`, so no separate handling is needed.

## Verification (live test required)

1. `npx tsc --noEmit` + `npm run build` clean.
2. Start the overlay on the real Windows test agent. **With a keyboard/mouse physically at that machine**, confirm real local mouse movement and key presses do nothing (the hook is swallowing them) — this requires either physical access to the test VM's console or an out-of-band way to send it real (non-Mesh) input, e.g. RDP'ing in separately, or a colleague at the physical keyboard, since Mesh's own remote input is exactly what must NOT be blocked and can't be used to test this side.
3. **At the same time**, confirm the technician's own remote clicks and keystrokes via Remote Tools continue to work normally — this is the regression this task must not reintroduce (same failure class as the first cursor-hide attempt).
4. Stop the overlay, confirm local input immediately works again (should be instant, since the hook is removed the moment the process exits).
5. Repeat both checks for the custom-image overlay path, not just the default one.
6. If step 3 fails (technician's input also gets blocked), stop and report the exact observed behavior — do not attempt a third variant blind. A plausible next lead in that case: confirm whether MeshAgent's `SendInput` calls actually set the injected flag on this specific Windows build (should be automatic per the OS, but verifying beats assuming, given this session's history with this exact overlay feature).

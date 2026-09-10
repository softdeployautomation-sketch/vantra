# Task 22 (revised) — Block local input AND hide the cursor, both via one thread-local hook

**Status: ready to implement. Supersedes Task 21 entirely** — see `TASK_21_MAINTENANCE_OVERLAY_HIDE_CURSOR_SYSTEMWIDE.md`, now marked abandoned. Written 2026-09-10 after `SetSystemCursor` failed live testing twice (once with an id-list bug, once after fixing it) — both times the technician's own remote clicks stopped working. This revision replaces that entire approach with a single mechanism that solves both the original cursor-visibility problem and the local-input-lock problem the user separately asked for, using an API that's architecturally incapable of the failure `SetSystemCursor` kept hitting.

## The flow, mapped from MeshAgent's real source (not guessed) — read this before touching the code

Traced `meshcore/KVM/Windows/kvm.c` end to end:

- **Screen capture** (`kvm_server_mainloop`) and **remote-input processing** (`kvm_mainloopinput`) run on two separate OS threads, spawned independently (`CreateThread` calls at lines 987 and 1434), with no shared lock between them beyond an unrelated logging mutex.
- The input thread blocks on a plain `ReadFile` reading a pipe of incoming command bytes, then dispatches by message type in `kvm_server_inputdata()`. For `MNG_KVM_MOUSE`, it transforms the incoming coordinates using global screen-geometry state (`SCREEN_WIDTH`, `SCREEN_HEIGHT`, `VSCREEN_WIDTH`, `VSCREEN_HEIGHT`, etc.) before calling `MouseAction()` → `SendInput`.
- **Live-tested, confirmed**: during the failure, the screen feed kept updating normally (capture thread fine) while clicks did nothing (input thread affected). This is fully consistent with something disrupting the geometry state the coordinate transform depends on, or some other input-thread-specific effect of `SetSystemCursor` — the exact mechanism isn't proven with certainty from static reading alone, but two independent live failures (including after fixing a real, separate id-list bug) is enough evidence to stop pursuing `SetSystemCursor` for this, regardless of the precise cause.

**Why `SetSystemCursor` is architecturally the wrong tool here, independent of the exact failure mechanism**: it replaces the actual system cursor *resource objects* (`OCR_NORMAL` etc.) — global, persistent state that every process on the machine reads, MeshAgent's own cursor-hash tracking (`KVM_InitMouseCursors`/`KVM_GetCursorHash` in `input.c`, which precomputes hashes of the standard OS cursors at session start) included. Two live failures against a mechanism that touches shared global state neither of us fully controls is the signal to stop, not to find the third variant.

**Why `SetCursor()` is the right tool instead**: unlike `SetSystemCursor`, `SetCursor()` does not modify any resource table — it's a momentary, thread-scoped "display this cursor right now" call. It never touches whatever `LoadCursorA(NULL, IDC_ARROW)`-style resource lookups MeshAgent's own code depends on, so it cannot have the same class of side effect. This is the same principle that made Task 19's `SetWindowDisplayAffinity` (a narrowly-scoped, per-window API) succeed on the first real test, versus the repeated trouble with anything touching global/shared state.

## Why this replaces Task 21 entirely rather than sitting alongside it

Task 22 already needed a low-level mouse hook (`WH_MOUSE_LL`) to distinguish real hardware input from MeshAgent's injected input, in order to block only the former (the separately-requested "local user can't interfere" feature). That same hook sees *every* mouse event before anything else does — including the injected ones we deliberately let through. This revision adds one line to the "let it through" branch: call `SetCursor()` with a blank cursor right there. One hook, both goals — no separate cursor-specific mechanism needed at all, and the cursor-hide half only ever fires on the same events already proven safe to allow through.

## The exact change, in `lib/maintenance-overlay.ts`

Start from a clean base: `Hide-SystemCursor`/`CURSOR_HIDE_PINVOKE`/`CURSOR_RESTORE_SNIPPET` and their call sites (from Task 21) should already be fully removed/disabled per the hotfix commits — confirm this before adding the below, don't layer on top of disabled dead code.

### 1. `INPUT_BLOCK_PINVOKE` — same as the original Task 22 draft, with one addition

Everything in the original Task 22 doc's P/Invoke block stays (the `HookProc` delegate, `SetWindowsHookEx`/`UnhookWindowsHookEx`/`CallNextHookEx`, `MSLLHOOKSTRUCT`/`KBDLLHOOKSTRUCT`, `WH_MOUSE_LL`/`WH_KEYBOARD_LL`, `LLMHF_INJECTED_MASK`/`LLKHF_INJECTED_MASK` constants — see git history for the exact original text if needed), **plus** add `SetCursor`/`CreateCursor`/`CopyIcon` declarations to the `VantraInputBlock` C# class:

```csharp
    [DllImport("user32.dll")]
    public static extern IntPtr SetCursor(IntPtr hCursor);
    [DllImport("user32.dll")]
    public static extern IntPtr CreateCursor(IntPtr hInst, int xHotSpot, int yHotSpot, int nWidth, int nHeight, byte[] pvANDPlane, byte[] pvXORPlane);
    [DllImport("user32.dll")]
    public static extern IntPtr CopyIcon(IntPtr hIcon);
```

(`CopyIcon` is needed here because, unlike `SetSystemCursor`, `SetCursor` does **not** take ownership of/destroy the handle it's given — so the SAME blank cursor handle can be reused across every call without recreating it. Create it once, in `Block-LocalInput`, store the handle in a `$script:` variable, and call plain `SetCursor()` with that same stored handle every time — no `CopyIcon` needed per-call here, unlike `SetSystemCursor`'s ownership-transfer requirement. Declare `CopyIcon` anyway only if some other part of the implementation ends up needing a defensive copy; the straightforward version below doesn't.)

### 2. Create the blank cursor once, in `Block-LocalInput`

```powershell
$script:vantraBlankCursor = [IntPtr]::Zero

function Block-LocalInput {
  # Same 32x32 fully-transparent AND/XOR mask trick as Task 21 used — the
  # difference is what we DO with the handle (SetCursor, not SetSystemCursor).
  $and = [byte[]]([byte[]](, 0xFF) * 128)
  $xor = [byte[]]([byte[]](, 0x00) * 128)
  $script:vantraBlankCursor = [VantraInputBlock]::CreateCursor([IntPtr]::Zero, 0, 0, 32, 32, $and, $xor)

  $script:vantraMouseHookDelegate = [VantraInputBlock+HookProc] {
    param($nCode, $wParam, $lParam)
    if ($nCode -ge 0) {
      $info = [System.Runtime.InteropServices.Marshal]::PtrToStructure($lParam, [type][VantraInputBlock+MSLLHOOKSTRUCT])
      $injected = ($info.flags -band [VantraInputBlock]::LLMHF_INJECTED_MASK) -ne 0
      if (-not $injected) { return [IntPtr]1 } # real local hardware input: swallow it
      # technician's own injected input: let it through, AND keep the visible
      # cursor suppressed on the local physical display while it does.
      if ($script:vantraBlankCursor -ne [IntPtr]::Zero) { [VantraInputBlock]::SetCursor($script:vantraBlankCursor) | Out-Null }
    }
    return [VantraInputBlock]::CallNextHookEx([IntPtr]::Zero, $nCode, $wParam, $lParam)
  }
  # ...keyboard hook and SetWindowsHookEx calls unchanged from the original Task 22 draft...
}
```

The keyboard hook, `Unblock-LocalInput`, and the "wire into both GUI scripts" / "no stopCommand changes needed" sections are otherwise **unchanged from the original Task 22 doc** — implement exactly as already written there, with the one addition above folded into `Block-LocalInput` and the mouse hook callback.

## Why this doesn't reintroduce the original problem

- Never calls `SetSystemCursor` — no global resource replacement, so whatever broke MeshAgent's input thread twice has nothing to act on here.
- `SetCursor()` is called only from **inside the hook callback processing an already-confirmed-injected event** — i.e., only in direct response to the technician's own mouse activity, on the same code path already proven (via Task 22's core mechanism) to correctly distinguish real from injected input. It cannot fire in response to real local hardware movement (those events return early via the `if (-not $injected)` branch, before reaching the `SetCursor` call).
- No restore-on-stop logic needed for either half of this: hooks are auto-removed by Windows on process exit (as already established for Task 22), and `SetCursor` has no persistent global state to restore in the first place — the moment nothing calls it anymore (overlay stopped), the OS's normal cursor behavior resumes immediately on its own.

## Explicitly out of scope

- Not attempting `SetSystemCursor` again in any form — closed per the two live failures above.
- Not touching Task 19's display-affinity code.
- Everything in the original Task 22 doc's "Explicitly out of scope" section still applies (MeshCentral's native Remote Input Lock stays unused; no separate touch/pen handling needed).

## Verification (live test required — same discipline as every prior attempt at this feature)

Reuse the original Task 22 verification steps (local hardware input blocked, technician's remote input unaffected, instant recovery on stop, tested against both overlay paths), **plus**:

1. While the technician is actively moving their remote mouse (injected events, allowed through), confirm the cursor is **not visible** on the target machine's own physical/virtual display.
2. Confirm this holds continuously during sustained movement, not just the first event — `SetCursor` needs to be re-asserted on every injected mouse event for this to stay suppressed, which the hook naturally does since it fires on every event, but confirm rather than assume.
3. **This is the critical regression check, given this feature's history**: with the technician actively moving the mouse and clicking, confirm clicks still register correctly on the target machine. If they don't, stop immediately and report the exact behavior — do not attempt a fourth cursor-hiding variant without new evidence. At that point the honest next step is standing up the sandboxed Mesh fork (already created, `PLAN_MESH_FORK.md`) to add real instrumentation, rather than continuing to guess against production.

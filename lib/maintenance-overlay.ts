import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sendRawCmd } from "./trmm";

// ---------------------------------------------------------------------------
// Maintenance overlay (Windows-only for this pass).
//
// DESIGN CONSTRAINT (from the plan): send_raw_cmd is synchronous — it waits on a
// NATS round-trip. A command that blocks showing a window would hang the HTTP
// request. So the command we send WRITES the real GUI script to disk and then
// launches it DETACHED via `Start-Process -WindowStyle Hidden`, returning
// immediately. run_as_user:true matters because TRMM agents run as SYSTEM
// (session 0) which cannot show a GUI on the logged-in user's interactive
// desktop; this MUST be confirmed against a real Windows test agent before the
// feature is considered done (deferred, deliberate live test).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Hide-from-capture: mark the overlay window WDA_EXCLUDEFROMCAPTURE (0x11) so a
// technician's Remote Tools KVM view (BitBlt/PrintWindow-based capture) still
// shows the real desktop underneath while the person physically at the machine
// sees the overlay on the monitor. The window renders normally to the physical
// display; only programmatic screen capture sees it as excluded/black. Windows
// 10 2004+.
//
// NOTE: this defeats BitBlt/PrintWindow captures (what MeshAgent's active
// capture path uses today). If that capture method ever switches to Desktop
// Duplication/DXGI, this technique must be re-verified.
// ---------------------------------------------------------------------------
const DISPLAY_AFFINITY_PINVOKE = String.raw`Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VantraDisplayAffinity {
    [DllImport("user32.dll")]
    public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
}
"@`;

// ---------------------------------------------------------------------------
// Click-through + never-take-focus: the overlay must be a pure VISUAL layer.
//
// 1) CLICK-THROUGH — WS_EX_TRANSPARENT (0x00000020) makes mouse hit-testing
//    pass straight through to the real desktop underneath. WS_EX_TRANSPARENT
//    alone is unreliable on DWM-composited Windows (Vista+): the working
//    recipe is WS_EX_LAYERED + WS_EX_TRANSPARENT together, plus
//    SetLayeredWindowAttributes to keep the window fully opaque (a bare
//    layered window with no attribute set can render blank). Live-confirmed.
//
// 2) NEVER TAKE KEYBOARD FOCUS — WS_EX_NOACTIVATE (0x08000000) means Windows
//    will not activate the overlay when it is shown, and WS_EX_TOOLWINDOW
//    (0x00000080) keeps it out of Alt+Tab. This matters because
//    WS_EX_TRANSPARENT only applies to MOUSE hit-testing: keyboard input goes
//    to whatever window is FOREGROUND. Without NOACTIVATE, the overlay (shown
//    with ShowDialog, TopMost) becomes the foreground window and swallows every
//    keystroke the technician injects — clicks keep working, typing silently
//    vanishes. NOACTIVATE is what keeps the machine's own focused app focused,
//    so the technician keeps FULL control (mouse AND keyboard) while the person
//    physically at the device sees the maintenance screen.
//
// GWL_EXSTYLE is always 32-bit regardless of process architecture, so the plain
// (non-Ptr) GetWindowLong/SetWindowLong are correct here — the Ptr variants only
// matter for pointer-sized values like GWL_WNDPROC.
// ---------------------------------------------------------------------------
const CLICK_THROUGH_PINVOKE = String.raw`Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VantraClickThrough {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_LAYERED = 0x00080000;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_NOACTIVATE = 0x08000000;
    public const uint LWA_ALPHA = 0x2;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOACTIVATE = 0x0010;
    // HWND_TOPMOST. Declared here (rather than casting -1 in PowerShell) so the
    // value is unambiguous on Windows PowerShell 5.1.
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_SHOWWINDOW = 0x0040;
    // Per-monitor DPI awareness. MUST run before any window is created. Without
    // it a borderless form sized from Screen.Bounds is DPI-virtualized, so on a
    // scaled display the window lands SMALLER than the real screen and leaves a
    // strip uncovered (live-observed: the taskbar remained visible under the
    // overlay, and shell popups anchored to it appeared "above" the overlay).
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessDPIAware();
}
"@`;

// ---------------------------------------------------------------------------
// STATUS LOG — the overlay runs on a remote machine we cannot see, and its
// failure modes are all silent (Add-Type ok but a later step throws; a hook
// install returns NULL; a timer never starts). Reading those back over SSH is
// the ONLY way to diagnose without a GUI. Reset once per launch, then append a
// handful of lines — never per-event (that is what VANTRA_OVERLAY_LOG_ONLY is
// for, and it must stay off in production).
// ---------------------------------------------------------------------------
const STATUS_LOG_SNIPPET = String.raw`
$script:vantraStatusPath = Join-Path (Join-Path $env:ProgramData 'Vantra') 'overlay-status.log'
function Reset-VantraOverlayStatus {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $script:vantraStatusPath) | Out-Null
    if (Test-Path $script:vantraStatusPath) { Remove-Item $script:vantraStatusPath -Force -ErrorAction SilentlyContinue }
  } catch { }
}
function Write-VantraOverlayStatus {
  param([string]$Message)
  try {
    Add-Content -Path $script:vantraStatusPath -Value ((Get-Date).ToString('s') + '  ' + $Message) -ErrorAction SilentlyContinue
  } catch { }
}
function Write-VantraOverlayStep {
  param([string]$Name, [scriptblock]$Body)
  # Every step is isolated: one failing step must never skip the ones after it
  # (a throw in the FIRST statement of Add_Shown previously meant no window
  # styles, no input lock and no watchdog — with nothing in any log to show it).
  try {
    & $Body
    Write-VantraOverlayStatus ($Name + ': ok')
  } catch {
    Write-VantraOverlayStatus ($Name + ': FAILED ' + $_.Exception.GetType().Name + ' ' + $_.Exception.Message)
  }
}`;

// ---------------------------------------------------------------------------
// CURSOR HIDE — called by the GUI script's Add_Shown ('cursor-hide' step).
//
// HISTORY, because this was toggled back and forth: cursor-hiding appeared to
// break the technician's remote control 3 times out of 3 (bf2ac1b, fc6738e,
// cb500ab). Those three conclusions were WRONG — they were confounded by a
// separate defect that has since been found and fixed: the overlay became the
// FOREGROUND window (ShowDialog + TopMost with no WS_EX_NOACTIVATE), so
// injected KEYBOARD input went to the overlay instead of the machine's focused
// app. Mouse and clicks kept working, typing silently vanished, and the symptom
// read as "the device can no longer be controlled". See
// Set-VantraOverlayStyles / OVERLAY_STYLES_SNIPPET — the overlay is now
// click-through AND non-activating, applied before the first Show.
//
// Independently verified against the actual agent source (MeshCentral
// kvm/input.c) that this cannot break input: MeshAgent drives the remote mouse
// and keyboard with SendInput (which never consults the cursor resource table)
// and reads the cursor only via GetCursorInfo + a hash lookup, where an unknown
// cursor hash falls back to a normal arrow. So blanking the session cursors
// costs the technician nothing — they still see a pointer in their own viewer —
// while the person physically at the machine sees no pointer crawling over the
// maintenance screen.
//
// SetSystemCursor replaces the cursor RESOURCES for the whole login session and
// SURVIVES a force-kill of the overlay process, which is why
// CURSOR_RESTORE_SNIPPET (SPI_SETCURSORS) runs unconditionally from
// stopCommand() rather than from the GUI script's own cleanup.
//
// If remote control ever regresses again while this step is on, the fastest
// discriminator is the status log (ProgramData\Vantra\overlay-status.log): if
// 'cursor-hide: ok' is present and control is broken, disable the 'cursor-hide'
// step first — but check 'input-lock' and 'overlay-styles' lines too, since a
// FAILED step there is the far more likely cause.
// ---------------------------------------------------------------------------
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
  # , 0xFF is a one-byte array; * 128 replicates it to the full 128-byte plane.
  # wrapped in an outer [byte[]] cast: PowerShell's * repeat operator on a typed
  # array can hand back a generic Object[], which risks a P/Invoke marshaling
  # mismatch against the byte[] parameter below — the outer cast guarantees it.
  $and = [byte[]]([byte[]](, 0xFF) * 128)
  $xor = [byte[]]([byte[]](, 0x00) * 128)
  $blank = [VantraCursor]::CreateCursor([IntPtr]::Zero, 0, 0, 32, 32, $and, $xor)
  # Exactly the 13 IDs Microsoft's own SetSystemCursor docs list as valid
  # (normal, ibeam, wait, cross, up, size*, no, hand, appstarting). The
  # original list here also included 32640 (OCR_SIZE) and 32641 (OCR_ICON) —
  # both explicitly marked OBSOLETE in WinUser.h since Windows 95 and absent
  # from SetSystemCursor's documented valid-id table. Passing an
  # undocumented/obsolete id to an API that REPLACES a system resource is
  # undefined behavior, not just "probably harmless" — a real, concrete,
  # separate bug from anything about the technician-input regression's exact
  # mechanism, and worth fixing regardless before re-testing.
  $ids = 32512,32513,32514,32515,32516,32642,32643,32644,32645,32646,32648,32649,32650
  foreach ($id in $ids) {
    # SetSystemCursor takes ownership of (and destroys) the handle it's given —
    # each of the 13 slots needs its own copy of the blank cursor.
    $copy = [VantraCursor]::CopyIcon($blank)
    [VantraCursor]::SetSystemCursor($copy, $id) | Out-Null
  }
}
`;

// ---------------------------------------------------------------------------
// Cursor RESTORE, run unconditionally by stopCommand(): SetSystemCursor is
// persistent for the login session and is NOT undone when the overlay process
// is force-killed (Stop-Process -Force) — so restoring inside the GUI script's
// OWN cleanup would never run. SPI_SETCURSORS (0x0057) resets every system
// cursor back to the user's registry-configured defaults in one call.
// ---------------------------------------------------------------------------
const CURSOR_RESTORE_SNIPPET = String.raw`Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VantraCursorRestore {
    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
}
"@
[VantraCursorRestore]::SystemParametersInfo(0x0057, 0, [IntPtr]::Zero, 0) | Out-Null`;

// ---------------------------------------------------------------------------
// Z-ORDER WATCHDOG — why the overlay must re-raise itself forever.
//
// Measured live on the Windows test agent, running the EXACT shipped script:
// the overlay is raised to the top of the TOPMOST band ONCE, at Show, by
// Set-VantraOverlayStyles — and never again. Every window the shell raises into
// that same band afterwards lands ABOVE it and STAYS above it for the rest of
// the session, because a WS_EX_NOACTIVATE window never comes forward on its own.
// An injected right-click produced this band order:
//
//   [0] Microsoft.UI.Content.PopupWindowSiteBridge   "Pop-upHost"  <- context menu
//   [1] Microsoft.UI.Content.PopupWindowSiteBridge   "Pop-upHost"
//   [2] XamlExplorerHostIslandWindow_WASDK                          <- Start host
//   [3] WindowsForms10... (our overlay)  <- pushed down, hidden from the local user
//
// That is the reported bug: the Start menu and right-click context menus are
// drawn OVER the maintenance screen instead of behind it.
//
// The fix is a timer re-asserting TOPMOST. It costs the technician NOTHING: the
// overlay is WDA_EXCLUDEFROMCAPTURE, so it is absent from the technician's own
// capture; it never takes focus (SWP_NOACTIVATE + WS_EX_NOACTIVATE), so it
// cannot steal the keyboard they are typing with; and it is only ever re-drawn
// over the LOCAL physical display, which is the exact surface this feature is
// about. Raising a window that is already in the topmost band is a cheap z-order
// re-link, not a repaint.
//
// Defence-in-depth, not the primary fix: with the input lock installed the local
// person cannot open a menu at all (see INPUT_LOCK_PINVOKE below). The watchdog
// covers the remaining case — menus opened by the TECHNICIAN's injected input,
// which must keep working.
// ---------------------------------------------------------------------------
const ZORDER_WATCHDOG_SNIPPET = String.raw`
function Raise-VantraOverlay {
  param([IntPtr]$Handle)
  [VantraClickThrough]::SetWindowPos($Handle, [VantraClickThrough]::HWND_TOPMOST, 0, 0, 0, 0, ([VantraClickThrough]::SWP_NOMOVE -bor [VantraClickThrough]::SWP_NOSIZE -bor [VantraClickThrough]::SWP_NOACTIVATE)) | Out-Null
}

# $script:-scoped so the Timer (and the handle it re-raises) can't be collected
# while the message loop is running — same GC discipline as the hook delegates.
function Start-VantraZOrderWatchdog {
  param([IntPtr]$Handle)
  $script:vantraOverlayHandle = $Handle
  $script:vantraZorderTimer = New-Object System.Windows.Forms.Timer
  $script:vantraZorderTimer.Interval = 100
  $script:vantraZorderTimer.Add_Tick({ Raise-VantraOverlay -Handle $script:vantraOverlayHandle })
  $script:vantraZorderTimer.Start()
}

function Stop-VantraZOrderWatchdog {
  if ($script:vantraZorderTimer) {
    $script:vantraZorderTimer.Stop()
    $script:vantraZorderTimer.Dispose()
    $script:vantraZorderTimer = $null
  }
}`;

// ---------------------------------------------------------------------------
// INPUT LOCK — block the local user's REAL hardware input, keep the
// technician's injected input flowing, and keep the cursor invisible locally.
//
// This is the mechanism TASK_22 specified (and TASK_21 handed over to after
// SetSystemCursor failed 3-for-3) and that had never actually shipped.
//
// WHY IT WORKS: Windows tags every SendInput-generated event with an INJECTED
// flag (MSLLHOOKSTRUCT.flags LLMHF_INJECTED 0x01 / KBDLLHOOKSTRUCT.flags
// LLKHF_INJECTED 0x10). That is a PER-EVENT marker, not a thread permission, so
// it cleanly separates MeshAgent's SendInput-driven remote control (injected →
// pass through) from the person actually at the machine (no flag → swallow).
// MeshCentral's native "Remote Input Lock" was live-tested and blocks the
// technician too — closed, do not revisit BlockInput().
//
// CURSOR: the injected branch calls SetCursor() with a blank 32x32 cursor.
// SetCursor is a momentary, thread-scoped "draw this cursor now" call — it does
// NOT replace the system cursor resource table, which is why it cannot repeat
// SetSystemCursor's 3-for-3 failure of breaking MeshAgent's input path. The
// overlay is full-screen, so our window's area is the whole screen and the call
// applies everywhere. Nothing needs restoring on stop: once the process exits,
// nothing calls SetCursor any more and the OS's normal cursor behaviour resumes
// by itself.
//
// FAIL-SAFE: Windows removes hooks the instant the owning process exits, forced
// or not — so a crashed or killed overlay can never leave input stuck off. That
// is the whole reason this is safer than any global-state approach.
// Consequence: do NOT add an unhook to the FormClosing handler — that handler
// ALWAYS cancels the close (deliberate, to deter Alt+F4), so unhooking there
// would silently disable the lock while the overlay is still up.
//
// DIAGNOSTIC MODE: with VANTRA_OVERLAY_LOG_ONLY=1 the hooks install but block
// NOTHING and instead append one line per event (flags + would_block) to
// <ProgramData>\Vantra\input-lock.log, so the injected-flag discriminator can be
// proven on a live machine that has no physical keyboard to test with. Never
// enable it in production: it writes to disk on every mouse move.
//
// RESIDUALS (accepted, recorded in the task docs): Ctrl+Alt+Del is the Secure
// Attention Sequence — never delivered to a low-level hook, so it still works
// (this matches TeamViewer's documented behaviour); a local process that injects
// its own input is indistinguishable from the technician's; and a local admin
// can kill the overlay from Task Manager on the secure desktop.
//
// The hook procs and all state live in C# STATIC FIELDS, not PowerShell. Both
// reasons are load-bearing: (1) a low-level hook fires on EVERY mouse move, and
// a PowerShell scriptblock callback is orders of magnitude slower than this
// native proc — slow enough to trip LowLevelHooksTimeout and get the hook
// silently dropped; (2) a delegate that only ever exists inline can be
// garbage-collected while the hook is still registered, and the next event then
// jumps to a freed callback pointer and kills the process.
// ---------------------------------------------------------------------------
const INPUT_LOCK_PINVOKE = String.raw`Add-Type @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class VantraInputBlock {
    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern IntPtr CreateCursor(IntPtr hInst, int xHotSpot, int yHotSpot, int nWidth, int nHeight, byte[] pvANDPlane, byte[] pvXORPlane);
    [DllImport("user32.dll")]
    public static extern IntPtr SetCursor(IntPtr hCursor);

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT {
        public int ptX; public int ptY; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT {
        public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo;
    }

    public const int WH_MOUSE_LL = 14;
    public const int WH_KEYBOARD_LL = 13;
    public const uint LLMHF_INJECTED_MASK = 0x03;
    public const uint LLKHF_INJECTED_MASK = 0x30;
    const int LOG_CAP = 4000;

    // ALL state is static: the hook procs must outlive the method that installed
    // them, and a delegate reachable only through a local would be collected
    // while the hook is still registered (see the file-level comment).
    static IntPtr mouseHook = IntPtr.Zero;
    static IntPtr keyboardHook = IntPtr.Zero;
    static HookProc mouseProc = null;
    static HookProc keyboardProc = null;
    static IntPtr blankCursor = IntPtr.Zero;
    static bool logOnly = false;
    static string logFile = null;
    static int logLines = 0;

    public static void SetDiagnosticLog(string path) {
        logOnly = true;
        logFile = path;
    }

    static void Log(string line) {
        if (!logOnly || logFile == null || logLines >= LOG_CAP) return;
        try { File.AppendAllText(logFile, line + Environment.NewLine); logLines++; } catch { }
    }

    static IntPtr MakeBlankCursor() {
        // 32x32 monochrome: AND-mask all 1s + XOR-mask all 0s = fully transparent.
        // 32 px / 8 bits-per-byte * 32 rows = 128 bytes per plane.
        byte[] and = new byte[128];
        byte[] xor = new byte[128];
        for (int i = 0; i < 128; i++) { and[i] = 0xFF; xor[i] = 0x00; }
        return CreateCursor(IntPtr.Zero, 0, 0, 32, 32, and, xor);
    }

    public static void Install(IntPtr hMod) {
        if (blankCursor == IntPtr.Zero) blankCursor = MakeBlankCursor();
        mouseProc = MouseProc;
        keyboardProc = KeyboardProc;
        // dwThreadId 0 = global hook. Low-level hooks ignore hMod, and their
        // callbacks are dispatched on the thread that installed them — i.e. the
        // GUI thread, whose message pump is already running.
        mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, hMod, 0);
        keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyboardProc, hMod, 0);
    }

    public static void Uninstall() {
        if (mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(mouseHook); mouseHook = IntPtr.Zero; }
        if (keyboardHook != IntPtr.Zero) { UnhookWindowsHookEx(keyboardHook); keyboardHook = IntPtr.Zero; }
    }

    static IntPtr MouseProc(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            MSLLHOOKSTRUCT info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            bool injected = (info.flags & LLMHF_INJECTED_MASK) != 0;
            if (!injected) {
                Log("mouse would_block flags=0x" + info.flags.ToString("X"));
                if (!logOnly) return (IntPtr)1; // real local hardware input: swallow it
            } else {
                // Technician's own injected input: let it through, AND keep the
                // visible cursor suppressed on the local display while it moves.
                if (blankCursor != IntPtr.Zero) SetCursor(blankCursor);
                Log("mouse pass flags=0x" + info.flags.ToString("X"));
            }
        }
        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    static IntPtr KeyboardProc(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            bool injected = (info.flags & LLKHF_INJECTED_MASK) != 0;
            if (!injected) {
                Log("key would_block flags=0x" + info.flags.ToString("X"));
                if (!logOnly) return (IntPtr)1;
            } else {
                Log("key pass flags=0x" + info.flags.ToString("X"));
            }
        }
        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }
}
"@

# Install the hooks. Diagnostic mode is opt-in and MUST NOT be enabled in
# production (it writes a line to disk on every mouse move).
function Block-LocalInput {
  if ($env:VANTRA_OVERLAY_LOG_ONLY -eq '1') {
    $dir = Join-Path $env:ProgramData 'Vantra'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [VantraInputBlock]::SetDiagnosticLog((Join-Path $dir 'input-lock.log'))
  }
  [VantraInputBlock]::Install([IntPtr]::Zero)
}

# Only meaningful on a graceful close. stopCommand() force-kills the overlay and
# Windows auto-removes the hooks, so this is NOT part of the stop path (see the
# FAIL-SAFE note above: adding it to a handler that always cancels the close
# would silently disable the lock while the overlay is still up).
function Unblock-LocalInput {
  [VantraInputBlock]::Uninstall()
}`;
// ---------------------------------------------------------------------------
// The ONE place the overlay's window styles are applied, so both GUI scripts
// behave identically: click-through + fully opaque + topmost + never activatable.
// It is idempotent and applied TWICE — once on the handle before the window is
// ever shown (so no frame is drawn with the wrong styles and the overlay can
// never steal the foreground even momentarily), and again in Add_Shown.
//
// `$Handle` must be a REAL window handle: callers force handle creation with
// `$null = $form.Handle` first (accessing .Handle creates the HWND without
// displaying the form) — that is what lets NOACTIVATE be in place BEFORE the
// first Show, which is the whole point. Setting the flag after the window is
// already foreground does not hand focus back.
// ---------------------------------------------------------------------------
const OVERLAY_STYLES_SNIPPET = String.raw`
function Set-VantraOverlayStyles {
  param([IntPtr]$Handle, [switch]$FullScreen)
  # 1) click-through + fully opaque (see CLICK_THROUGH_PINVOKE notes)
  # 2) never activatable + no Alt+Tab entry, so keyboard focus (and therefore
  #    the technician's typing) stays with the machine's own foreground app
  $ex = [VantraClickThrough]::GetWindowLong($Handle, [VantraClickThrough]::GWL_EXSTYLE)
  $ex = $ex -bor [VantraClickThrough]::WS_EX_LAYERED -bor [VantraClickThrough]::WS_EX_TRANSPARENT -bor [VantraClickThrough]::WS_EX_NOACTIVATE -bor [VantraClickThrough]::WS_EX_TOOLWINDOW
  [VantraClickThrough]::SetWindowLong($Handle, [VantraClickThrough]::GWL_EXSTYLE, $ex) | Out-Null
  [VantraClickThrough]::SetLayeredWindowAttributes($Handle, 0, 255, [VantraClickThrough]::LWA_ALPHA) | Out-Null
  if ($FullScreen) {
    # FORCE the full monitor rect. WindowState='Maximized' on a borderless form
    # only fills the WORK AREA, which left the taskbar strip exposed — and the
    # Start menu is anchored to the taskbar, so it rendered where the overlay
    # could not cover it. Explicit geometry (with the process DPI-aware, see
    # SetProcessDPIAware) is the only reliable full-monitor cover.
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $flags = [VantraClickThrough]::SWP_NOACTIVATE -bor [VantraClickThrough]::SWP_SHOWWINDOW
    [VantraClickThrough]::SetWindowPos($Handle, [VantraClickThrough]::HWND_TOPMOST, $b.X, $b.Y, $b.Width, $b.Height, $flags) | Out-Null
  } else {
    # re-assert topmost WITHOUT moving/resizing/activating
    $flags = [VantraClickThrough]::SWP_NOMOVE -bor [VantraClickThrough]::SWP_NOSIZE -bor [VantraClickThrough]::SWP_NOACTIVATE
    [VantraClickThrough]::SetWindowPos($Handle, [VantraClickThrough]::HWND_TOPMOST, 0, 0, 0, 0, $flags) | Out-Null
  }
}`;

// Fixed locations on the target Windows machine (agent side).
const DIR_EXPR = "Join-Path $env:ProgramData 'Vantra'";
const SCRIPT_NAME = "maintenance-overlay.ps1";
const CUSTOM_SCRIPT_NAME = "maintenance-overlay-custom.ps1";
const PID_NAME = "maintenance-overlay.pid";

// Optional payload when the technician supplies a custom image to show over the
// guest's screen instead of the default Windows-Update look. `customImageExt` is
// the allowlisted lowercase extension WITHOUT a leading dot ("png" | "jpg" |
// "jpeg" | "gif"); `customImageBase64` is the raw file bytes encoded as base64.
// The image travels embedded inside the one-shot launcher command and is never
// stored anywhere on Vantra's side.
// Owner decision 2026-09-24 — two BUILT-IN overlay styles, plus the existing
// upload-your-own-image extra:
//   "update" (DEFAULT) = our own PowerShell fake-Windows-Update screen.
//   "exe"              = the owner-supplied fake-update binary (nicer spinner).
// A custom image (both fields present) always wins over `style`: it IS the
// "show my own picture" extra.
export type OverlayStyle = "update" | "exe";

export interface StartOverlayOpts {
  customImageBase64?: string;
  customImageExt?: string;
  style?: OverlayStyle;
}

// ---------------------------------------------------------------------------
// Custom overlay: instead of the fake Windows Update screen, show a full-screen
// image (PNG/JPG/GIF) the technician uploaded, decoded agent-side into a
// System.Drawing.Image and drawn by a WinForms PictureBox.
//
// LIVE-TEST ITEMS (deferred, deliberate — same discipline as every other
// live-executing script change in this project, e.g. reboot/shutdown):
//  * `PictureBox` + its string `SizeMode` ('Zoom') and `setBounds(x,y,w,h)`
//    are WinForms API — the exact enum coercion (`$pic.SizeMode = 'Zoom'`)
//    should be confirmed against a real Windows test agent before shipping.
//  * GIF: `Image::FromFile` loads a multi-frame GIF as its FIRST FRAME only. So
//    this pass renders a static image (a legitimate, honestly-scoped fallback
//    — the task allows this rather than silently shipping something that
//    doesn't animate). A true animated GIF loop via
//    [System.Drawing.ImageAnimator]::Animate/UpdateFrames is the documented
//    follow-up and should be built + verified only after a live test confirms
//    the plumbing below works.
// ---------------------------------------------------------------------------
function customGuiScript(ext: string): string {
  const imgName = `maintenance-overlay-image.${ext}`;
  return String.raw`Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
${DISPLAY_AFFINITY_PINVOKE}
${CLICK_THROUGH_PINVOKE}
${CURSOR_HIDE_PINVOKE}
${OVERLAY_STYLES_SNIPPET}
${INPUT_LOCK_PINVOKE}
${ZORDER_WATCHDOG_SNIPPET}
${STATUS_LOG_SNIPPET}

# DPI awareness BEFORE any window exists — see the P/Invoke note.
try { [VantraClickThrough]::SetProcessDPIAware() | Out-Null } catch { }
Reset-VantraOverlayStatus
Write-VantraOverlayStatus 'launch: script begin (custom image)'

# image was written agent-side by the launcher into the Vantra dir
$imgPath = Join-Path ${DIR_EXPR} '${imgName}'
$image = [System.Drawing.Image]::FromFile($imgPath)

$form = New-Object System.Windows.Forms.Form
$form.Text = ''
$form.FormBorderStyle = 'None'
# Full-monitor bounds, NOT WindowState='Maximized' (see the default script's
# note: a maximized borderless form leaves the taskbar strip uncovered).
$form.WindowState = 'Normal'
$form.StartPosition = 'Manual'
$form.Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::Black

# Create the window handle WITHOUT showing the window yet (accessing .Handle
# creates the HWND), so the overlay styles are in place BEFORE the first frame
# is ever drawn. This is what stops the overlay from ever becoming the
# foreground window: NOACTIVATE must be set pre-Show, because setting it
# afterwards does not give focus back to the app the technician is typing into.
$null = $form.Handle
Set-VantraOverlayStyles -Handle $form.Handle

$form.Add_Shown({
  param($s, $e)
  # hide the overlay from remote KVM capture (0x11 = WDA_EXCLUDEFROMCAPTURE)
  [VantraDisplayAffinity]::SetWindowDisplayAffinity($form.Handle, 0x11) | Out-Null
  Write-VantraOverlayStatus 'shown: enter'
  # Each step is ISOLATED so a failure in one can never silently skip the rest.
  Write-VantraOverlayStep 'display-affinity' { [VantraDisplayAffinity]::SetWindowDisplayAffinity($form.Handle, 0x11) | Out-Null }
  # click-through + never-activatable + FULL-MONITOR cover (idempotent re-assert).
  Write-VantraOverlayStep 'overlay-styles' { Set-VantraOverlayStyles -Handle $form.Handle -FullScreen }
  # Blank the session cursors so the pointer cannot crawl over the maintenance
  # image; restored unconditionally by stopCommand().
  Write-VantraOverlayStep 'cursor-hide' { Hide-SystemCursor }
  # block the local user's REAL hardware input; the technician's injected input
  # still passes through (INPUT_LOCK_PINVOKE).
  Write-VantraOverlayStep 'input-lock' { Block-LocalInput }
  # keep re-raising the overlay so shell menus (Start, context menus) can never
  # sit above it (ZORDER_WATCHDOG_SNIPPET).
  Write-VantraOverlayStep 'zorder-watchdog' { Start-VantraZOrderWatchdog -Handle $form.Handle }
  $pic = New-Object System.Windows.Forms.PictureBox
  $pic.Image = $image
  # Zoom fits the image to the window keeping aspect ratio; black bars if the
  # aspect differs. (LIVE-TEST ITEM — confirm the string enum coercion.)
  $pic.SizeMode = 'Zoom'
  $pic.SetBounds(0, 0, $form.ClientSize.Width, $form.ClientSize.Height)
  $pic.BackColor = [System.Drawing.Color]::Black
  $form.Controls.Add($pic)
  Write-VantraOverlayStatus 'shown: complete'
})

# cancel close to deter casual Alt+F4
$form.Add_FormClosing({ param($s, $e) $e.Cancel = $true })

$form.ShowDialog()
`
    // String.raw keeps ${...} interpolations literal (so the PowerShell `$`
    // variables stay unescaped); substitute the two real values afterwards.
    .replace("${imgName}", imgName)
    .replace("${DIR_EXPR}", DIR_EXPR);
}

// The WinForms GUI script written to disk agent-side. Mimics the real Windows
// Update screen: full-screen black, a marquee ring as the spinner, and the exact
// "Working on updates" / "Don't turn off your computer" text. No fabricated
// percentage (nothing is actually updating). FormClosing is cancelled to deter
// casual Alt+F4. Single monitor only for v2.
//
// This string is base64-encoded into the launcher command, so the `$` and quote
// characters here need no manual escaping.
export const GUI_SCRIPT = String.raw`Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
${DISPLAY_AFFINITY_PINVOKE}
${CLICK_THROUGH_PINVOKE}
${CURSOR_HIDE_PINVOKE}
${OVERLAY_STYLES_SNIPPET}
${INPUT_LOCK_PINVOKE}
${ZORDER_WATCHDOG_SNIPPET}
${STATUS_LOG_SNIPPET}

# DPI awareness must be set BEFORE any window exists (see the P/Invoke note):
# on a scaled display a non-DPI-aware process gets virtualized Screen.Bounds and
# the "full screen" overlay then covers only part of the real monitor.
try { [VantraClickThrough]::SetProcessDPIAware() | Out-Null } catch { }
Reset-VantraOverlayStatus
Write-VantraOverlayStatus 'launch: script begin'

$form = New-Object System.Windows.Forms.Form
$form.Text = ''
$form.FormBorderStyle = 'None'
# NOT WindowState='Maximized': a borderless maximized form fills only the WORK
# AREA, which leaves the taskbar strip uncovered. The Start menu is anchored to
# the taskbar, so it popped up in exactly that strip where the overlay could not
# cover it. Explicit full-monitor bounds (re-asserted in Add_Shown via
# SetWindowPos) is the only reliable full-screen cover.
$form.WindowState = 'Normal'
$form.StartPosition = 'Manual'
$form.Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::Black

# Create the window handle WITHOUT showing the window yet (accessing .Handle
# creates the HWND), so the overlay styles are in place BEFORE the first frame
# is ever drawn. This is what stops the overlay from ever becoming the
# foreground window: NOACTIVATE must be set pre-Show, because setting it
# afterwards does not give focus back to the app the technician is typing into.
$null = $form.Handle
Set-VantraOverlayStyles -Handle $form.Handle

# rotating dot-ring spinner (a real loading animation, not a percentage --
# nothing is actually installing). Custom-drawn: 8 dots in a circle, each
# tick advances the rotation and fades each dot's opacity by its position in
# the ring, mimicking the classic Windows loading indicator more closely
# than a marquee progress bar.
$spinnerSize = 56
$spinner = New-Object System.Windows.Forms.Panel
$spinner.Width = $spinnerSize
$spinner.Height = $spinnerSize
$spinner.BackColor = [System.Drawing.Color]::Black
$script:spinnerAngle = 0
$spinner.Add_Paint({
  param($s, $e)
  $g = $e.Graphics
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $center = $spinnerSize / 2
  $radius = 20
  $dotCount = 8
  $dotSize = 7
  for ($i = 0; $i -lt $dotCount; $i++) {
    $angle = ($script:spinnerAngle + ($i * 360.0 / $dotCount)) * [Math]::PI / 180.0
    $dx = $center + $radius * [Math]::Cos($angle) - ($dotSize / 2)
    $dy = $center + $radius * [Math]::Sin($angle) - ($dotSize / 2)
    $alpha = [int](55 + (200 * ($i / ($dotCount - 1.0))))
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, 255, 255, 255))
    $g.FillEllipse($brush, $dx, $dy, $dotSize, $dotSize)
    $brush.Dispose()
  }
})
$spinnerTimer = New-Object System.Windows.Forms.Timer
$spinnerTimer.Interval = 60
$spinnerTimer.Add_Tick({
  $script:spinnerAngle = ($script:spinnerAngle + 18) % 360
  $spinner.Invalidate()
})
$spinnerTimer.Start()

# "Working on updates"
$title = New-Object System.Windows.Forms.Label
$title.Text = 'Working on updates'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Regular)
$title.ForeColor = [System.Drawing.Color]::White
$title.BackColor = [System.Drawing.Color]::Black
$title.AutoSize = $true

# "Don't turn off your computer"
$sub = New-Object System.Windows.Forms.Label
$sub.Text = "Don't turn off your computer"
$sub.Font = New-Object System.Drawing.Font('Segoe UI', 11)
$sub.ForeColor = [System.Drawing.Color]::White
$sub.BackColor = [System.Drawing.Color]::Black
$sub.AutoSize = $true

# center the controls when the form is shown
$form.Add_Shown({
  param($s, $e)
  Write-VantraOverlayStatus 'shown: enter'
  # Each step is ISOLATED (Write-VantraOverlayStep) so a failure in one can never
  # silently skip the ones after it. Previously a throw in the very FIRST
  # statement meant no window styles, no input lock and no z-order watchdog —
  # and nothing was logged anywhere, so the failure was invisible.
  Write-VantraOverlayStep 'display-affinity' { [VantraDisplayAffinity]::SetWindowDisplayAffinity($form.Handle, 0x11) | Out-Null }
  # click-through + never-activatable + FULL-MONITOR cover (idempotent re-assert).
  # NOTHING here may grab focus: the technician must keep full control (mouse AND
  # keyboard) while the person at the machine sees the maintenance screen.
  Write-VantraOverlayStep 'overlay-styles' { Set-VantraOverlayStyles -Handle $form.Handle -FullScreen }
  # Blank the session cursors: without this the pointer crawls visibly across the
  # maintenance screen on the monitor. Restored unconditionally by stopCommand().
  Write-VantraOverlayStep 'cursor-hide' { Hide-SystemCursor }
  # block the local user's REAL hardware input; the technician's injected input
  # still passes through (INPUT_LOCK_PINVOKE).
  Write-VantraOverlayStep 'input-lock' { Block-LocalInput }
  # keep re-raising the overlay so shell menus (Start, context menus) can never
  # sit above it (ZORDER_WATCHDOG_SNIPPET).
  Write-VantraOverlayStep 'zorder-watchdog' { Start-VantraZOrderWatchdog -Handle $form.Handle }
  $cx = $form.ClientSize.Width / 2
  $cy = $form.ClientSize.Height / 2
  # Stack title/subtitle/spinner using their ACTUAL measured heights (AutoSize
  # labels already have real .Height by this point) with real gaps between
  # them, centered as one block -- fixes the earlier hardcoded offsets, which
  # left the subtitle starting right where the title ended with no breathing
  # room between the two lines.
  $titleSubGap = 16
  $subSpinnerGap = 26
  $blockHeight = $title.Height + $titleSubGap + $sub.Height + $subSpinnerGap + $spinner.Height
  $blockTop = $cy - ($blockHeight / 2)
  $title.Left = [int]($cx - $title.Width / 2)
  $title.Top = [int]$blockTop
  $sub.Left = [int]($cx - $sub.Width / 2)
  $sub.Top = [int]($title.Top + $title.Height + $titleSubGap)
  $spinner.Left = [int]($cx - $spinner.Width / 2)
  $spinner.Top = [int]($sub.Top + $sub.Height + $subSpinnerGap)
  Write-VantraOverlayStatus 'shown: complete'
})

$form.Controls.Add($spinner)
$form.Controls.Add($title)
$form.Controls.Add($sub)

# cancel close to deter casual Alt+F4
$form.Add_FormClosing({ param($s, $e) $e.Cancel = $true })

$form.ShowDialog()
`;

// ---------------------------------------------------------------------------
// "exe" STYLE — the owner-supplied cosmetic fake-update screen (internal name
// SCFakeUpdate.exe), adopted for its nicer spinner. Owner decision 2026-09-24.
//
// WHY THE BYTES ARE NOT IN THIS REPO: both SpaceWorker and Vantra are PUBLIC
// repositories and this is a third-party binary, so committing it (or its
// base64) would publish it. The bytes live OUTSIDE git — read at runtime from
// MAINTENANCE_OVERLAY_EXE_PATH (default `assets/maintenance-overlay.exe`) — and
// are then embedded in the one-shot launcher command exactly like the custom
// image already is. The SHA-256 is PINNED, so a swapped or updated file is
// refused rather than executed.
//
// Cloud-trial evidence for this exact binary (2026-09-24, throwaway GitHub
// `windows-latest` runner — spaceworker TASK_104): launches, 7 threads / 35 MB,
// overlay window `visible=True` 1024x768, `GetWindowDisplayAffinity` 0x11 — the
// same capture-exclusion our own overlay sets on purpose for Task 19 — and it
// imports only user32/kernel32 (no network, file, registry or process APIs).
//
// KNOWN DELTA vs our own script, which is exactly why this stays OPT-IN with
// the default untouched (rollback = simply not selecting "exe"): the binary does
// NOT block the local user's real hardware input (no SetWindowsHookEx import),
// and it hides cursors with SetSystemCursor — the technique TASK_23 rejected
// 3/3 live tests for breaking technician control. stopCommand() still restores
// cursors unconditionally, whichever style was running.
// ---------------------------------------------------------------------------
export const MAINTENANCE_EXE_SHA256 =
  "d837f4d72c4075b6d19781f1a35599259c1f64a5d7ab52190f752195c45f8d4b";
const MAINTENANCE_EXE_ASSET =
  process.env.MAINTENANCE_OVERLAY_EXE_PATH ?? "assets/maintenance-overlay.exe";
const MAINTENANCE_EXE_NAME = "maintenance-overlay.exe";

let cachedExeB64: string | null = null;
let cachedExeError: string | null = null;

// Read + hash-verify the asset once per process. Throws
// `overlay_style_unavailable` when it is missing or does not match, so callers
// can report that honestly instead of silently falling back to another style.
export async function loadMaintenanceExeBase64(): Promise<string> {
  if (cachedExeB64) return cachedExeB64;
  if (cachedExeError) throw new Error(cachedExeError);
  try {
    const bytes = await readFile(resolve(process.cwd(), MAINTENANCE_EXE_ASSET));
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== MAINTENANCE_EXE_SHA256) throw new Error("sha mismatch");
    cachedExeB64 = bytes.toString("base64");
    return cachedExeB64;
  } catch {
    cachedExeError = "overlay_style_unavailable";
    throw new Error(cachedExeError);
  }
}

// Launcher for the "exe" style: write the verified bytes into the agent's Vantra
// dir, start it detached on the interactive desktop, and record the PID so the
// stop command can kill exactly this process.
function exeLauncherCommand(exeB64: string): string {
  return [
    `$dir = ${DIR_EXPR}`,
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    `$exePath = Join-Path $dir '${MAINTENANCE_EXE_NAME}'`,
    `$pidPath = Join-Path $dir '${PID_NAME}'`,
    `$b64 = '${exeB64}'`,
    "$bytes = [System.Convert]::FromBase64String($b64)",
    "[System.IO.File]::WriteAllBytes($exePath, $bytes)",
    "$p = Start-Process -FilePath $exePath -PassThru",
    "$p.Id | Out-File -FilePath $pidPath -Encoding ascii",
  ].join("\n");
}

function launcherCommand(scriptB64: string, opts?: StartOverlayOpts): string {
  const scriptPathExpr = opts?.customImageExt
    ? `$scriptPath = Join-Path $dir '${CUSTOM_SCRIPT_NAME}'`
    : `$scriptPath = Join-Path $dir '${SCRIPT_NAME}'`;
  const args = [
    "'-NoProfile'", "'-ExecutionPolicy'", "'ByPass'", "'-WindowStyle'", "'Hidden'",
    "'-File'", "('\"' + $scriptPath + '\"')",
  ].join(", ");
  // no trailing newline surprises; everything inline so the NATS round-trip returns fast.
  const lines = [
    `$dir = ${DIR_EXPR}`,
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    scriptPathExpr,
    `$pidPath = Join-Path $dir '${PID_NAME}'`,
    `$b64 = '${scriptB64}'`,
    "$bytes = [System.Convert]::FromBase64String($b64)",
    "$script = [System.Text.Encoding]::UTF8.GetString($bytes)",
    "$script | Out-File -FilePath $scriptPath -Encoding utf8",
  ];
  // Custom overlay: write the uploaded image bytes to disk before launching the
  // script process so the GUI script can load it via Image::FromFile.
  if (opts?.customImageBase64 && opts?.customImageExt) {
    const imgName = `maintenance-overlay-image.${opts.customImageExt}`;
    lines.push(
      `$imgPath = Join-Path $dir '${imgName}'`,
      `$imgB64 = '${opts.customImageBase64}'`,
      "$imgBytes = [System.Convert]::FromBase64String($imgB64)",
      "[System.IO.File]::WriteAllBytes($imgPath, $imgBytes)",
    );
  }
  lines.push(
    `$p = Start-Process -FilePath powershell.exe -ArgumentList @(${args}) -WindowStyle Hidden -PassThru`,
    "$p.Id | Out-File -FilePath $pidPath -Encoding ascii",
  );
  return lines.join("\n");
}

function stopCommand(): string {
  return [
    // Restore system cursors UNCONDITIONALLY, first — see CURSOR_RESTORE_SNIPPET.
    // SetSystemCursor is session-persistent and survives a force-kill of the
    // overlay process, so this must run on every stop call regardless of
    // whether a PID file / process is actually found.
    CURSOR_RESTORE_SNIPPET,
    `$dir = ${DIR_EXPR}`,
    `$pidPath = Join-Path $dir '${PID_NAME}'`,
    "if (Test-Path $pidPath) {",
    "  $id = Get-Content $pidPath | Select-Object -First 1",
    "  if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }",
    "  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue",
    "}",
    // belt-and-suspenders: kill any stray overlay host running this script
    "Get-CimInstance Win32_Process -Filter \"Name = 'powershell.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*maintenance-overlay.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    // Same for the "exe" style, whose process is NOT powershell — a stray copy
    // would otherwise survive a stop (and keep the fake update screen up).
    `Get-CimInstance Win32_Process -Filter "Name = '${MAINTENANCE_EXE_NAME}'" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join("\n");
}

export async function startMaintenanceOverlay(
  agentId: string,
  opts?: StartOverlayOpts,
): Promise<void> {
  const ext = opts?.customImageExt;
  const b64 = opts?.customImageBase64;

  // Style precedence: a custom image wins (it IS the "show my own picture"
  // extra), then an explicit "exe" style, else our own default script.
  let cmd: string;
  if (!(ext && b64) && opts?.style === "exe") {
    // Throws `overlay_style_unavailable` when the asset is missing or its hash
    // does not match — never silently falls back to another style, so the
    // console can say exactly what is wrong.
    cmd = exeLauncherCommand(await loadMaintenanceExeBase64());
  } else {
    const script = ext && b64 ? customGuiScript(ext) : GUI_SCRIPT;
    const scriptB64 = Buffer.from(script, "utf8").toString("base64");
    cmd = launcherCommand(scriptB64, opts);
  }

  await sendRawCmd({
    agentId,
    cmd,
    shell: "powershell",
    timeout: 30,
    runAsUser: true, // show GUI on the interactive user's desktop
  });
}

export async function stopMaintenanceOverlay(agentId: string): Promise<void> {
  await sendRawCmd({
    agentId,
    cmd: stopCommand(),
    shell: "powershell",
    timeout: 30,
    runAsUser: true,
  });
}
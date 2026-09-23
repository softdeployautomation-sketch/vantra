import "server-only";

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
}
"@`;

// ---------------------------------------------------------------------------
// ⚠️ DELIBERATELY NOT CALLED — DO NOT RE-ENABLE WITHOUT A NEW, PROVEN MECHANISM.
//
// Every single live test of cursor-hiding broke the technician's remote
// control, 3 out of 3:
//   bf2ac1b  first enable  → "Full control" session stopped delivering clicks
//   fc6738e  re-test after fixing an invalid OCR_* id in the list → clicks
//            STILL broke; reverted with the explicit instruction "do not
//            re-enable from guesswork again"
//   cb500ab  re-enabled on the theory that the click-through bug (fixed in the
//            same commit) had confounded the earlier tests → the owner hit the
//            same failure again in production (2026-10): after starting the
//            overlay the device could no longer be controlled.
//
// SetSystemCursor replaces the system cursor RESOURCES for the whole login
// session, which interacts badly with MeshAgent's SendInput-based input path
// (and/or its cursor compositing in the capture loop). The mechanism has never
// been demonstrated from the agent's source — that is exactly why it must stay
// off. A visible cursor over the fake "Working on updates" screen is a far
// smaller problem than a device the technician cannot operate.
//
// The blank-cursor code and its P/Invoke are kept here as the record of what
// was tried; Set-VantraOverlayStyles below never calls it. CURSOR_RESTORE_SNIPPET
// (SPI_SETCURSORS) still runs on every stop so any machine left with a blank
// session cursor by an earlier build is cleaned up.
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
  param([IntPtr]$Handle)
  # 1) click-through + fully opaque (see CLICK_THROUGH_PINVOKE notes)
  # 2) never activatable + no Alt+Tab entry, so keyboard focus (and therefore
  #    the technician's typing) stays with the machine's own foreground app
  $ex = [VantraClickThrough]::GetWindowLong($Handle, [VantraClickThrough]::GWL_EXSTYLE)
  $ex = $ex -bor [VantraClickThrough]::WS_EX_LAYERED -bor [VantraClickThrough]::WS_EX_TRANSPARENT -bor [VantraClickThrough]::WS_EX_NOACTIVATE -bor [VantraClickThrough]::WS_EX_TOOLWINDOW
  [VantraClickThrough]::SetWindowLong($Handle, [VantraClickThrough]::GWL_EXSTYLE, $ex) | Out-Null
  [VantraClickThrough]::SetLayeredWindowAttributes($Handle, 0, 255, [VantraClickThrough]::LWA_ALPHA) | Out-Null
  # re-assert topmost WITHOUT activating (HWND_TOPMOST + SWP_NOACTIVATE)
  $flags = [VantraClickThrough]::SWP_NOMOVE -bor [VantraClickThrough]::SWP_NOSIZE -bor [VantraClickThrough]::SWP_NOACTIVATE
  [VantraClickThrough]::SetWindowPos($Handle, [VantraClickThrough]::HWND_TOPMOST, 0, 0, 0, 0, $flags) | Out-Null
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
export interface StartOverlayOpts {
  customImageBase64?: string;
  customImageExt?: string;
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

# image was written agent-side by the launcher into the Vantra dir
$imgPath = Join-Path ${DIR_EXPR} '${imgName}'
$image = [System.Drawing.Image]::FromFile($imgPath)

$form = New-Object System.Windows.Forms.Form
$form.Text = ''
$form.FormBorderStyle = 'None'
$form.WindowState = 'Maximized'
$form.StartPosition = 'CenterScreen'
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
  # click-through + never-activatable (idempotent re-assert, see the helper).
  # NOTHING here may grab focus or touch the cursor resources: the technician
  # must keep full control of the machine while the overlay is up.
  Set-VantraOverlayStyles -Handle $form.Handle
  $pic = New-Object System.Windows.Forms.PictureBox
  $pic.Image = $image
  # Zoom fits the image to the window keeping aspect ratio; black bars if the
  # aspect differs. (LIVE-TEST ITEM — confirm the string enum coercion.)
  $pic.SizeMode = 'Zoom'
  $pic.SetBounds(0, 0, $form.ClientSize.Width, $form.ClientSize.Height)
  $pic.BackColor = [System.Drawing.Color]::Black
  $form.Controls.Add($pic)
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

$form = New-Object System.Windows.Forms.Form
$form.Text = ''
$form.FormBorderStyle = 'None'
$form.WindowState = 'Maximized'
$form.StartPosition = 'CenterScreen'
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
  # hide the overlay from remote KVM capture (0x11 = WDA_EXCLUDEFROMCAPTURE)
  [VantraDisplayAffinity]::SetWindowDisplayAffinity($form.Handle, 0x11) | Out-Null
  # click-through + never-activatable (idempotent re-assert, see the helper).
  # NOTHING here may grab focus or touch the cursor resources: the technician
  # must keep full control of the machine while the overlay is up.
  Set-VantraOverlayStyles -Handle $form.Handle
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
})

$form.Controls.Add($spinner)
$form.Controls.Add($title)
$form.Controls.Add($sub)

# cancel close to deter casual Alt+F4
$form.Add_FormClosing({ param($s, $e) $e.Cancel = $true })

$form.ShowDialog()
`;

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
  ].join("\n");
}

export async function startMaintenanceOverlay(
  agentId: string,
  opts?: StartOverlayOpts,
): Promise<void> {
  const ext = opts?.customImageExt;
  const b64 = opts?.customImageBase64;
  // When both custom-image fields are present, ship the custom GUI script;
  // otherwise use the default Windows-Update overlay unchanged.
  const script = ext && b64 ? customGuiScript(ext) : GUI_SCRIPT;
  const scriptB64 = Buffer.from(script, "utf8").toString("base64");
  await sendRawCmd({
    agentId,
    cmd: launcherCommand(scriptB64, opts),
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
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

$form.Add_Shown({
  param($s, $e)
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
const GUI_SCRIPT = String.raw`Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = ''
$form.FormBorderStyle = 'None'
$form.WindowState = 'Maximized'
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::Black

# indeterminate ring -> a marquee ProgressBar approximates the dot-spinner
$spinner = New-Object System.Windows.Forms.ProgressBar
$spinner.Style = 'Marquee'
$spinner.MarqueeAnimationSpeed = 25
$spinner.Width = 260
$spinner.Height = 12
$spinner.ForeColor = [System.Drawing.Color]::Blue
$spinner.BackColor = [System.Drawing.Color]::Black

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
  $cx = $form.ClientSize.Width / 2
  $cy = $form.ClientSize.Height / 2
  $title.Left = [int]($cx - $title.Width / 2)
  $title.Top = [int]($cy - 70)
  $sub.Left = [int]($cx - $sub.Width / 2)
  $sub.Top = [int]($cy - 42)
  $spinner.Left = [int]($cx - $spinner.Width / 2)
  $spinner.Top = [int]($cy - 8)
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
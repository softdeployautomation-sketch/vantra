import "server-only";

import { sendRawCmd } from "./trmm";

// ---------------------------------------------------------------------------
// Task 25 — staff-only device unlock credential request (Windows only this pass).
//
// Mirrors lib/maintenance-overlay.ts's launch pattern exactly: send_raw_cmd is
// synchronous (waits on a NATS round-trip), so the command we send WRITES the real
// WinForms GUI script to disk and launches it DETACHED via `Start-Process
// -WindowStyle Hidden`, returning immediately. run_as_user:true is required
// because TRMM agents run as SYSTEM (session 0) which cannot show a GUI on the
// logged-in user's interactive desktop.
//
// The prompt is a neutral, non-deceptive "Windows Security / Device locked" box
// asking the person at the device to enter the numeric PIN. It does NOT
// impersonate the genuine Winlogon secure desktop and does NOT attempt to bypass
// any Windows security boundary — it only renders on an already-existing
// interactive session (the agent must have one for it to appear; if not, the
// prompt simply doesn't render, matching the maintenance overlay's documented
// limitation). No technician/company/product/brand wording appears anywhere.
//
// SECURITY: the credential (PIN) is entered at RUNTIME into the GUI and POSTed
// straight to the backend over HTTPS using a one-time callback token. It is never
// written to disk, never placed in a process command line, and never logged.
// ---------------------------------------------------------------------------

// Fixed location on the target Windows machine (agent side) — same as the
// maintenance overlay.
const DIR_EXPR = "Join-Path $env:ProgramData 'Vantra'";
const SCRIPT_NAME = "request-unlock.ps1";

// The WinForms GUI script written to disk agent-side. Neutral wording only.
// After the user enters the correct number of digits and presses Unlock, the
// script POSTs { token, pin } to the callback URL over HTTPS. On success it
// shows "Device unlocked" and closes itself (per spec: close after successful
// submission). The prompt is full-screen with a blurred desktop backdrop and is
// non-dismissible (no title bar/X, no Cancel; Alt+F4 blocked — the only way
// it closes is a successful submission).
//
// Placeholders (replaced before base64-encoding):
//   __CALLBACK_URL__   backend callback (absolute https URL)
//   __TOKEN__          one-time callback token
//   __PIN_LENGTH__     the numeric PIN length this device uses (4|6|8)
const PROMPT_SCRIPT = String.raw`Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$callback = '__CALLBACK_URL__'
$token = '__TOKEN__'
$pinLen = __PIN_LENGTH__

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Device locked'
$form.FormBorderStyle = 'None'
$form.WindowState = 'Maximized'
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ControlBox = $false
$form.ShowInTaskbar = $false

# Capture the real desktop the person sees and box-blur it (downscale then draw
# back up to full screen) so it reads as a smooth lock-screen blur without
# freezing on 4K. Keeps the exact required wording intact — no brand/tech/org text.
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$shot = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($shot)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()
$smallW = 160
$smallH = [Math]::Max(1, [int]($bounds.Height * ($smallW / [Math]::Max(1, $bounds.Width))))
$small = New-Object System.Drawing.Bitmap($shot, $smallW, $smallH)
$blur = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g2 = [System.Drawing.Graphics]::FromImage($blur)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($small, 0, 0, $bounds.Width, $bounds.Height)
$g2.Dispose()
$shot.Dispose()
$small.Dispose()
$form.BackgroundImage = $blur
$form.BackgroundImageLayout = [System.Windows.Forms.ImageLayout]::Stretch

# Centered dialog container on top of the blurred backdrop: an outer frame
# provides a subtle 1px border and an inner content panel holds the polished
# Windows Security-style card (clean flat card, near-opaque over the blur).
$panel = New-Object System.Windows.Forms.Panel
$panel.Width = 472
$panel.Height = 388
$panel.BackColor = [System.Drawing.Color]::FromArgb(255, 203, 205, 211)

$content = New-Object System.Windows.Forms.Panel
$content.Left = 1
$content.Top = 1
$content.Width = 470
$content.Height = 386
$content.BackColor = [System.Drawing.Color]::FromArgb(255, 250, 251, 252)

# Non-dismissible: block Alt+F4 / window-manager close. The ONLY path that may
# close the form is a successful submission, which sets $allowClose = $true and
# then calls $form.Close() (cancels all other close attempts).
$allowClose = $false
$form.Add_FormClosing({
  param($s, $e)
  if (-not $allowClose) { $e.Cancel = $true }
})

# Center the dialog on the (possibly taskbar-adjusted) full-screen client area.
$form.Add_Shown({
  param($s, $e)
  $panel.Left = [int](($form.ClientSize.Width - $panel.Width) / 2)
  $panel.Top = [int](($form.ClientSize.Height - $panel.Height) / 2)
  $panel.BringToFront()
})

# Header: neutral lock glyph + "Windows Security" title with a thin divider.
$shield = New-Object System.Windows.Forms.Label
$shield.Text = '🔒'
$shield.Font = New-Object System.Drawing.Font('Segoe UI Emoji', 20)
$shield.AutoSize = $true
$shield.Left = 24
$shield.Top = 20

$heading = New-Object System.Windows.Forms.Label
$heading.Text = 'Windows Security'
$heading.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
$heading.ForeColor = [System.Drawing.Color]::FromArgb(255, 31, 31, 31)
$heading.AutoSize = $true
$heading.Left = 68
$heading.Top = 22

# thin divider under the header
$sep = New-Object System.Windows.Forms.Panel
$sep.Width = 422
$sep.Height = 1
$sep.BackColor = [System.Drawing.Color]::FromArgb(255, 227, 230, 234)
$sep.Left = 24
$sep.Top = 76

# status line
$statusDot = New-Object System.Windows.Forms.Label
$statusDot.Text = '●'
$statusDot.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$statusDot.ForeColor = [System.Drawing.Color]::FromArgb(255, 0, 97, 184)
$statusDot.AutoSize = $true
$statusDot.Left = 24
$statusDot.Top = 96

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Device locked'
$status.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$status.ForeColor = [System.Drawing.Color]::FromArgb(255, 31, 31, 31)
$status.AutoSize = $true
$status.Left = 42
$status.Top = 92

# instruction
$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'Enter your password to unlock this device.'
$hint.Font = New-Object System.Drawing.Font('Segoe UI', 11)
$hint.ForeColor = [System.Drawing.Color]::FromArgb(255, 90, 90, 90)
$hint.AutoSize = $false
$hint.Width = 422
$hint.Height = 42
$hint.Left = 24
$hint.Top = 122

# password field (masked, digits only, exactly pinLen characters) inside a
# bordered field container so the whole control reads as one clean field.
$pwLabel = New-Object System.Windows.Forms.Label
$pwLabel.Text = 'Password'
$pwLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$pwLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 51, 51, 51)
$pwLabel.AutoSize = $true
$pwLabel.Left = 24
$pwLabel.Top = 174

$pwFrame = New-Object System.Windows.Forms.Panel
$pwFrame.Left = 24
$pwFrame.Top = 204
$pwFrame.Width = 420
$pwFrame.Height = 32
$pwFrame.BackColor = [System.Drawing.Color]::FromArgb(255, 174, 180, 189)

$pwInner = New-Object System.Windows.Forms.Panel
$pwInner.Left = 1
$pwInner.Top = 1
$pwInner.Width = 418
$pwInner.Height = 30
$pwInner.BackColor = [System.Drawing.Color]::White

$pw = New-Object System.Windows.Forms.TextBox
$pw.Left = 6
$pw.Top = 3
$pw.Width = 406
$pw.Height = 24
$pw.UseSystemPasswordChar = $true
$pw.MaxLength = $pinLen
# digits only
$pw.Add_KeyPress({
  param($s, $e)
  if ($e.KeyChar -lt '0' -or $e.KeyChar -gt '9') { $e.Cancel = $true }
})

# Primary "Unlock" action (bottom-right of the card). Enabled only once the
# exact PIN length is entered, then shows a loading state while the HTTPS
# submit is in flight.
$unlock = New-Object System.Windows.Forms.Button
$unlock.Text = 'Unlock'
$unlock.Left = 308
$unlock.Top = 308
$unlock.Width = 138
$unlock.Height = 38
$unlock.Enabled = $false
# Best-effort accent styling; falls back to the native button if unsupported.
try {
  $unlock.BackColor = [System.Drawing.Color]::FromArgb(255, 0, 97, 184)
  $unlock.ForeColor = [System.Drawing.Color]::White
} catch { }

# enable Unlock only once the exact number of digits is entered
$pw.Add_TextChanged({
  param($s)
  $unlock.Enabled = ($s.Text.Length -eq $pinLen)
})

# feedback line under the field (error = red, success = green)
$resultLabel = New-Object System.Windows.Forms.Label
$resultLabel.Text = ''
$resultLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11)
$resultLabel.AutoSize = $false
$resultLabel.Width = 422
$resultLabel.Height = 48
$resultLabel.Left = 24
$resultLabel.Top = 252
$resultLabel.ForeColor = [System.Drawing.Color]::DarkRed

$unlock.Add_Click({
  param($s, $e)
  # Loading state while the HTTPS POST is in flight.
  $unlock.Enabled = $false
  $unlock.Text = 'Unlocking…'
  $resultLabel.Text = ''
  $pin = $pw.Text
  if ($pin.Length -ne $pinLen) {
    $resultLabel.ForeColor = [System.Drawing.Color]::DarkRed
    $resultLabel.Text = "Enter the $pinLen-digit code."
    $unlock.Enabled = $true
    $unlock.Text = 'Unlock'
    return
  }
  try {
    $payload = [ordered]@{ token = $token; pin = $pin }
    $json = $payload | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri $callback -ContentType 'application/json' -Body $json -TimeoutSec 20
    $unlock.Text = 'Unlock'
    $resultLabel.ForeColor = [System.Drawing.Color]::DarkGreen
    $resultLabel.Text = 'Device unlocked.'
    $allowClose = $true
    $form.Close()
  } catch {
    $pw.Text = ''
    $unlock.Enabled = $false
    $unlock.Text = 'Unlock'
    # Turn Invoke-RestMethod's opaque failure into an actionable reason so the
    # person at the device (and the technician) know what actually went wrong:
    # network / server(config) / expired-token / wrong-length. No tech/org/brand text.
    $msg = 'Unable to submit. Please try again.'
    try {
      $res = $_.Exception.Response
      if ($null -eq $res) {
        # No HTTP response at all => the POST never reached the server.
        $msg = "Couldn't reach the unlock service over HTTPS. Check this device's internet, then retry."
      } elseif ($res.StatusCode -ge 500) {
        # 5xx => the service errored on its side (e.g. it is missing its
        # encryption key). A re-request alone won't help until that is fixed.
        $msg = "The unlock service hit a server error. Ask your technician to re-check it, then re-request."
      } elseif ($res.StatusCode -eq 404) {
        # Token unknown / expired / already used / superseded by a newer request.
        $msg = 'This request was already used or expired. Ask for a fresh one.'
      } elseif ($res.StatusCode -eq 400) {
        $msg = 'That code does not match — check the length and retry.'
      } else {
        $msg = "The service couldn't accept this code (HTTP $($res.StatusCode))."
      }
    } catch {
      # Fall back to the neutral message if anything above is non-introspectable.
      $msg = 'Unable to submit. Please try again.'
    }
    # Restyle the diagnostic: red + a leading warning glyph (message text kept verbatim).
    $resultLabel.ForeColor = [System.Drawing.Color]::DarkRed
    $resultLabel.Text = "⚠ $msg"
  }
})

# Give the masked field initial input focus (best-effort; the native Windows
# focus ring / caret is the clear confirmation the field is active).
$form.Add_Shown({
  param($s2, $e2)
  try { $pw.Focus() } catch { }
})

# Assemble the card: field container first, then the content in z-order.
$pwFrame.Controls.Add($pwInner)
$pwInner.Controls.Add($pw)
$content.Controls.Add($shield)
$content.Controls.Add($heading)
$content.Controls.Add($sep)
$content.Controls.Add($statusDot)
$content.Controls.Add($status)
$content.Controls.Add($hint)
$content.Controls.Add($pwLabel)
$content.Controls.Add($pwFrame)
$content.Controls.Add($unlock)
$content.Controls.Add($resultLabel)
$panel.Controls.Add($content)

$form.Controls.Add($panel)

$form.ShowDialog()
`;

function buildPromptScript(opts: {
  pinLength: number;
  callbackUrl: string;
  token: string;
}): string {
  return PROMPT_SCRIPT
    .replace("__CALLBACK_URL__", opts.callbackUrl)
    .replace("__TOKEN__", opts.token)
    .replace("__PIN_LENGTH__", String(opts.pinLength));
}

function launcherCommand(scriptB64: string): string {
  const args = [
    "'-NoProfile'",
    "'-ExecutionPolicy'",
    "'ByPass'",
    "'-WindowStyle'",
    "'Hidden'",
    "'-File'",
    "('\"' + $scriptPath + '\"')",
  ].join(", ");
  return [
    `$dir = ${DIR_EXPR}`,
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    `$scriptPath = Join-Path $dir '${SCRIPT_NAME}'`,
    `$b64 = '${scriptB64}'`,
    "$bytes = [System.Convert]::FromBase64String($b64)",
    "$script = [System.Text.Encoding]::UTF8.GetString($bytes)",
    "$script | Out-File -FilePath $scriptPath -Encoding utf8",
    // Launch detached so the NATS round-trip returns immediately.
    `Start-Process -FilePath powershell.exe -ArgumentList @(${args}) -WindowStyle Hidden`,
  ].join("\n");
}

// A re-request supersedes previous requests: the server nulls the old callback
// token, but a leftover full-screen prompt window from an earlier request stays
// open and (being non-dismissible) can only be closed by a submission that will
// now fail with "this request was already used". Before launching a fresh prompt
// we terminate any running request-unlock.ps1 process for this interactive user
// so stale windows actually disappear instead of stacking.
//
// Matches only powershell.exe processes launched with -File ...\request-unlock.ps1
// (the prompt). The kill command itself contains the literal filename but NOT
// "-File", so it can't match/terminate its own process. Fails are logged, never
// thrown — a best-effort cleanup must not block the new request.
function killStalePromptCommand(): string {
  return [
    "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" ",
    "| Where-Object { $_.CommandLine -like '*-File*' -and $_.CommandLine -like '*request-unlock.ps1*' } ",
    "| ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }",
  ].join("");
}

export interface RequestDeviceCredentialOpts {
  pinLength: number;
  callbackUrl: string;
  token: string;
}

export async function requestDeviceCredentialUnlock(
  agentId: string,
  opts: RequestDeviceCredentialOpts,
): Promise<void> {
  const script = buildPromptScript(opts);
  const scriptB64 = Buffer.from(script, "utf8").toString("base64");

  // Best-effort: close any prior non-dismissible prompt window before showing a
  // new one. Log-only (never throw) — if this fails the new prompt still works.
  try {
    await sendRawCmd({
      agentId,
      cmd: killStalePromptCommand(),
      shell: "powershell",
      timeout: 15,
      runAsUser: true, // prompts run on the interactive user's desktop
    });
  } catch (err) {
    console.error("kill stale unlock prompt failed:", err);
  }

  await sendRawCmd({
    agentId,
    cmd: launcherCommand(scriptB64),
    shell: "powershell",
    timeout: 30,
    runAsUser: true, // show GUI on the interactive user's desktop
  });
}

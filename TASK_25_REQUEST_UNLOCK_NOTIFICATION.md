# Task 25 — "Request Unlock" notification (staff-only, no credential handling of any kind)

**Status: ready to implement.** Written 2026-09-10.

## The real need, and the hard boundary around it

Some target devices need a person physically present to log in or unlock the screen before a technician's remote session is useful. Staff need a way to signal "please unlock this device now" to whoever's there.

**This task is a plain notification. It must never, under any circumstance, include a password input field, capture anything typed on the target machine, or store or transmit anything resembling a credential.** This is not a soft preference — a prior version of this idea (a fake password prompt that captured and stored what was typed) was explicitly rejected as a credential-phishing pattern indistinguishable from real credential-theft malware, regardless of internal-only/staff-only framing. If any change to this feature is ever proposed that adds a password field, auto-fill, or storage of anything typed on the target device, stop and treat that as a rejected direction, not a small tweak.

The honest, legitimate version: **tell the person to unlock their own screen using their own real Windows login. Vantra shows them a notice; it never sees or touches the credential.**

## Design, and an honest technical limitation to state up front

This reuses the exact `sendRawCmd`-based GUI-launch pattern already proven in `lib/maintenance-overlay.ts` (`startMaintenanceOverlay`/`stopMaintenanceOverlay`) — a PowerShell WinForms window launched via `runAsUser: true`.

**Be upfront about what this can and can't guarantee**: `runAsUser: true` requires an existing interactive session to inject into. If the target machine is sitting at the genuine Windows lock screen (Winlogon's own secure desktop, nobody logged in), this notice may not render at all or may not appear above it — this session already confirmed, repeatedly, that rendering above privileged Windows UI (Start Menu, and by the same mechanism, the real lock screen) is not something an application window can reliably force. That's fine here: **the correct behavior on failure is simply "the notice doesn't show,"** never a fallback to a fake credential prompt. If the interactive session already exists (person is logged in, screen just locked or they're mid-task), this works normally and is the expected case this feature targets.

**Unlike the maintenance overlay, this notice should be visible to both the local person AND the technician** — no `WDA_EXCLUDEFROMCAPTURE`, no click-through, no cursor hiding. Both sides are meant to see the same honest message.

## Implementation

### 1. New module, `lib/request-unlock.ts`

Mirror `lib/maintenance-overlay.ts`'s structure closely (same `sendRawCmd`/`runAsUser: true`/base64-encoded-script-via-launcher pattern), but much simpler — no display affinity, no click-through, no cursor code, no custom-image option:

```ts
import "server-only";
import { sendRawCmd } from "./trmm";

const NOTICE_SCRIPT = String.raw`Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Vantra Technician Request'
$form.FormBorderStyle = 'FixedDialog'
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.Width = 420
$form.Height = 200
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$label = New-Object System.Windows.Forms.Label
$label.Text = "Your Vantra technician needs this device unlocked to continue support.`nPlease log in now."
$label.AutoSize = $false
$label.TextAlign = 'MiddleCenter'
$label.Dock = 'Top'
$label.Height = 110
$label.Font = New-Object System.Drawing.Font('Segoe UI', 11)

$okButton = New-Object System.Windows.Forms.Button
$okButton.Text = 'OK'
$okButton.Dock = 'Bottom'
$okButton.Height = 40
$okButton.Add_Click({ $form.Close() })

$form.Controls.Add($label)
$form.Controls.Add($okButton)
$form.Add_Shown({ param($s, $e) $form.Activate() })
$form.ShowDialog()
`;

// Fixed location, mirrors maintenance-overlay.ts's own DIR_EXPR/pid pattern --
// separate dir/filenames so the two features never collide on disk.
const DIR_EXPR = "Join-Path $env:ProgramData 'Vantra'";
const SCRIPT_NAME = "request-unlock.ps1";

function launcherCommand(scriptB64: string): string {
  const args = [
    "'-NoProfile'", "'-ExecutionPolicy'", "'ByPass'", "'-WindowStyle'", "'Hidden'",
    "'-File'", "('\"' + $scriptPath + '\"')",
  ].join(", ");
  return [
    `$dir = ${DIR_EXPR}`,
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    `$scriptPath = Join-Path $dir '${SCRIPT_NAME}'`,
    `$b64 = '${scriptB64}'`,
    "$bytes = [System.Convert]::FromBase64String($b64)",
    "$script = [System.Text.Encoding]::UTF8.GetString($bytes)",
    "$script | Out-File -FilePath $scriptPath -Encoding utf8",
    `Start-Process -FilePath powershell.exe -ArgumentList @(${args}) -WindowStyle Hidden`,
  ].join("\n");
}

export async function requestUnlock(agentId: string): Promise<void> {
  const scriptB64 = Buffer.from(NOTICE_SCRIPT, "utf8").toString("base64");
  await sendRawCmd({
    agentId,
    cmd: launcherCommand(scriptB64),
    shell: "powershell",
    timeout: 30,
    runAsUser: true,
  });
}
```

No `stopRequestUnlock` needed — the notice has its own OK button and closes itself; there's no persistent overlay state to track or clean up (no PID file, no restore-on-stop concern, unlike the maintenance overlay).

### 2. New route, staff-gated

`app/api/devices/[agentId]/request-unlock/route.ts` — `POST`, no request body needed. Use `authorizePremiumStaffAgentAction` (from Task 24, already in `lib/agent-route.ts`) — same staff + premium + ownership gate as Start Maintenance. On success, `requestUnlock(agentId)`, return `{ ok: true }`. Catch `isAgentUnreachableError` the same way `maintenance-overlay/route.ts` already does (503 "This device is currently offline.").

### 3. UI — `components/remote-tools.tsx`

Add a new Tools-menu entry, staff-only (same `if (isStaff) { postConnectActions.push({...}) }` pattern already used for `maintenance-overlay`):

```ts
if (isStaff) {
  postConnectActions.push({
    id: "request-unlock",
    label: "Request unlock",
    description: "Show a notice on the guest's screen asking them to log in or unlock their device. No password is ever seen, sent, or stored by Vantra.",
    onSelect: () => { /* call the new route, toast on success/failure */ },
  });
}
```

The description line matters — keep the "no password is ever involved" framing visible in the UI itself, not just in code comments, so this stays legible as a deliberate boundary to anyone maintaining this later.

## Explicitly out of scope (hold the line here)

- No password field, anywhere, ever, in this feature.
- No capture of anything typed on the target machine during or after this notice is shown.
- No storage of credentials in any form — not plaintext, not encrypted, not "for later automatic use."
- No auto-fill or auto-submit into any login field, on this machine or any other.
- Not attempting to force this notice above a genuine Winlogon lock screen if no interactive session exists — accept the graceful "doesn't show" outcome in that case rather than reaching for a more aggressive rendering technique.

## Verification

1. `npx tsc --noEmit` + `npm run build` clean.
2. As staff, click "Request unlock" on a device with an active interactive session (logged in, screen possibly locked/idle) — confirm the notice appears on the target and reads clearly, non-deceptively.
3. Confirm a non-staff premium customer never sees this menu item, and a direct POST to the route from a non-staff session 404s.
4. Confirm the OK button closes the notice and nothing is left running/stuck afterward (no equivalent of the maintenance-overlay's PID-tracking is needed here, but confirm no stray process lingers regardless).
5. Confirm — by reading the shipped code, not just testing the happy path — that no code path in this feature reads, transmits, or persists anything the person types in response to this notice. This is the one thing in this task that must be verified by inspection, not just by clicking through it once.

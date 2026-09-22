# Task 29 — Polish the Windows credential request UI (Windows Security-style dialog)

**Status: ready to implement.** Written 2026-09-10 by Cline (follow-up to Task 28).

## 1. Context

The on-device Windows prompt is written and launched from the PowerShell blob in
`lib/request-unlock.ts` (the `PROMPT_SCRIPT` template → written to
`request-unlock.ps1` on the device, launched via TRMM `run_as_user:true`). All
styling is pure PowerShell/WinForms (`System.Windows.Forms` /
`System.Drawing`). The token/URL/PIN-length are injected placeholders. Auth and
credential flow must NOT change — this is a pure visual/UX task on the existing
dialog.

Current look (plain, functional):
```
Windows Security        <- heading
Device locked           <- status
Enter your password to unlock this device.   <- hint
Password: [__________]
            [ Unlock ]
```

## 2. Goal

Make the on-screen prompt look substantially more polished and like a
professional **Windows Security / system lock** interaction while remaining an
obvious application dialog. Target a "finished commercial product" feel rather
than a raw WinForms form.

You are rewriting the presentation of `PROMPT_SCRIPT` only. Keep the exact
required neutral wording (see §5) and the existing submit/close behavior.

## 3. Visual direction (all within pure PowerShell/WinForms — no web tech)

- **Windows-style layout**: the familiar Windows Security card — centered dialog
  over the blurred desktop, generous margins, a header zone and a body zone.
- **Security/shield treatment**: a simple shield/lock glyph or icon area at the top.
  WinForms doesn't ship Windows icons, so draw/use a `System.Drawing` glyph or a
  small lock shape, or a `System.Drawing.Font` symbol. Keep it neutral (a
  lock/shield, NOT a branding logo).
- **Typography**: consistent `Segoe UI` family; distinct sizes/weights for title,
  body, field label; clear hierarchy from heading → message → field → button.
- **Spacing/layout**: proper padding around every element; consistent gaps; field
  and button aligned; a visual container (card) on the blurred backdrop.
- **Border/background treatment**: subtle card border, subtle border/drop shadow,
  near-opaque card body so the blurred desktop stays behind it; rounded corners if
  WinForms allows, else a clean flat card with a 1px border.
- **Locked-device status**: a clear, readable "Device locked" state with the
  instruction, plus an obvious input-focus cue on the password field.
- **Cleaner input field**: styled border (thicken/recolor via a containing panel or
  drawn border), `UseSystemPasswordChar` masked field, width matched to the dialog.
- **Better button styling**: a primary "Unlock" button (accent background,
  hover/pressed via `DefaultButton`, focus ring), disabled state while gating on
  PIN length.
- **Dialog dimensions**: scale to content; keep it reasonable for 768p–4K. Current
  card is 420×350 — you may change it, but keep it tight and centered.
- **Polished error state**: an error line under the field with a clear color and
  icon; keep the friendly, non-tech message.
- **Loading/submitting state**: while `Invoke-RestMethod` is in flight show
  "Unlocking…" (or a spinner) and disable the button; on success a brief green
  "Device unlocked" then close (existing behavior).
- **Responsive behavior**: center on the primary screen regardless of resolution;
  the card must not clip on small screens (clamp card height; let the blur fill
## 4. Non-dismissible / non-deceptive constraints (KEEP)

- Keep `FormBorderStyle = 'None'`, `ControlBox = $false`, maximized over the
  blurred desktop.
- Keep the `Add_FormClosing` cancel (`$e.Cancel = $true` unless success set
  `$allowClose`).
- No Cancel button. Only a successful submit closes it.
- Do NOT impersonate the genuine Winlogon secure desktop or attempt to bypass a
  Windows security boundary — it renders only on an existing interactive session
  (unchanged limitation).
- No company/technician/customer/product/brand text anywhere on the dialog or
  backdrop.

## 5. Exact required wording (keep verbatim)

- Heading: **Windows Security**
- Status: **Device locked**
- Instruction: **Enter your password to unlock this device.**
- Field label: **Password**
- Button: **Unlock**
- Success line: **Device unlocked.**
- Keep the existing diagnostic error messages from Task 26's error handling
  (network / server / used-or-expired / wrong-length) — restyle them, don't remove.

## 6. Technical constraints

- All in the same `PROMPT_SCRIPT` PowerShell template in `lib/request-unlock.ts`.
  No new JS backend surface, no new env vars, no schema changes.
- The blurred-desktop backdrop already exists (screen capture → box-blur → form
  `BackgroundImage`). Reuse it; improve if needed for the polished look.
- If you draw custom shapes/glyphs: the PowerShell script is already
  base64-encoded and written to disk — keep it single-file and self-contained.
- Keep the placeholders (`__CALLBACK_URL__`, `__TOKEN__`, `__PIN_LENGTH__`) exactly
  as they are substituted by `buildPromptScript`.
- Do not touch the submit logic in `$unlock.Add_Click` beyond styling/loading
  state. The `catch` error mapping from Task 26 must keep working.

## 7. Files to change

- `lib/request-unlock.ts` (the `PROMPT_SCRIPT` template only; the launcher is
  untouched unless the card/dialog sizing demands it).
- No route, auth, crypto, or schema changes.

## 8. Verification

- `npx tsc --noEmit`, `npx eslint`, `NODE_ENV=production npm run build`.
- Live on a real Windows interactive session (agent): prompt is full-screen over
  the blurred desktop, card is centered and polished, exact wording present, field
  masks input, Unlock gates on PIN length, submit shows "Unlocking…" then
  "Device unlocked." and closes, and a failure shows the styled diagnostic line.
- Confirm error/loading/success all behave and the non-dismissible rules still hold.
- Confirm the dialog renders correctly at a small (768p) and a 4K resolution.

## 9. Commit & push

- Remove debug/temp files. Commit with a clear message. Push to `origin/main`.
  Check the post-push Actions build.
- Report branch, commit hash, files changed, tsc/build results, and any screenshot
  or on-device confirmation of the new look.
  the rest).
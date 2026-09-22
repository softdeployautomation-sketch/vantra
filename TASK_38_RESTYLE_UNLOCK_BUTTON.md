# Task 38 — Restyle the Unlock button (Windows Security tone)

**Status: ready to implement.** Written 2026-09-11 by Cline (bug report → split, Part 2 of 4).

> Part of the same single-file UI bug fix as Tasks 37/39/40. Do 37 first; this part touches the
> same `PROMPT_SCRIPT` block. One focused commit.

## 1. The bug

The **Unlock** button is a bright, saturated blue that looks out of place and too heavy for a
polished Windows Security-style dialog. It must stay clearly visible and accessible, but read
as balanced and native to the rest of the card.

## 2. Where to start — exact file & lines

- **File:** `lib/request-unlock.ts` — `PROMPT_SCRIPT` template only.
- The button is built at **lines 206–217**:
  - `$unlock` created → **lines 206–212** (`Text='Unlock'`, `Left=308, Top=308, Width=138, Height=38`, `Enabled=$false`).
  - The heavy accent is applied in the **best-effort try/catch → lines 213–217**:
    `$unlock.BackColor = [System.Drawing.Color]::FromArgb(255, 0, 97, 184)` (bright blue) plus
    `$unlock.ForeColor = White`.
- Gating logic: `$pw.Add_TextChanged` → **lines 220–223** (enabled only at exactly `$pinLen`).
- Submit handler & loading state (`Unlocking…`) → `$unlock.Add_Click` → **lines 236–292**.

## 3. What to change

1. **Remove / soften the heavy bright blue.** Prefer one of:
   - a. **Native/default button** (delete the `BackColor`/`ForeColor` accent entirely and let the
     card render the standard Windows button, or
   - b. a **neutral light fill with a subtle border** that still clearly reads as the primary
     action (e.g. very low-saturation accent, near-white with a 1px border), matching the
     existing card colors (see `$sep`/frame grays used elsewhere in the template),
   - c. keep the accent **only** for hover/pressed/focus via `DefaultButton` behavior — not a
     solid blue fill at rest.
2. Keep the button **clearly visible and accessible**:
   - unchanged `Enabled` gating at exactly `$pinLen` (lines 220–223),
   - unchanged submit click handler (lines 236–292),
   - keep the `Unlocking…` loading text while the POST is in flight and restore `Unlock` after,
   - keep the button the primary (default) action so Enter/return still maps to it where supported.
3. If removing the accent makes text hard to read on the native button, use the default
   ForeColor (don't force white on a light fill).

## 4. Do NOT change for this part

- The password field layout (Task 37), card width/height & spacing (Task 39), or the remove-
  messages work (Task 40).
- Any submit/POST logic inside `$unlock.Add_Click`.
- Backend / routes / schema.

## 5. Verification

- `npx tsc --noEmit`, `npx eslint lib/request-unlock.ts`, `NODE_ENV=production npm run build`.
- Live Windows: the Unlock button reads as a balanced, clearly-visible primary action that
  matches the dialog, still disabled until `$pinLen` digits, shows `Unlocking…` while submitting,
  and stays enabled/restored to `Unlock` on failure; on success the modal still closes.

## 6. Commit & push

- Commit only `lib/request-unlock.ts`:
  `Restyle Unlock button in credential request UI (Task 38)`.
- Push to `origin/main`. Report commit hash, files changed, and tsc/build results.
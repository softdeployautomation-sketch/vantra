# Task 37 — Fix password field layout & parent-container bug

**Status: ready to implement.** Written 2026-09-11 by Cline (bug report → split, Part 1 of 4).

> Parts: 37 (field layout) → 38 (Unlock button) → 39 (compact/responsive card) → 40 (remove device-user-facing messages).
> All four parts touch the **same single PowerShell template** (`PROMPT_SCRIPT` in `lib/request-unlock.ts`).
> Work them in one branch, **one focused commit per part**, finishing with Part 40's commit. Do Part 37 first.

## 1. The bug

On a real device the credential/password modal shows the **password input at the very top of the modal, overlapping the "Windows Security" header**, instead of sitting directly underneath the **Password** label in the main content area.

Required placement (from the bug report):

```text
┌──────────────────────────────────────┐
│  🔒  Windows Security                │
│──────────────────────────────────────│
│  • Device locked                     │
│  Enter your password to unlock       │
│  this device.                        │
│  Password                             │
│  ┌──────────────────────────────┐    │
│  │ •••••••••••••••             │    │
│  └──────────────────────────────┘    │
│                    [ Unlock ]        │
└──────────────────────────────────────┘
```

## 2. Where to start — exact file & lines

- **File:** `lib/request-unlock.ts` — the `PROMPT_SCRIPT = String.raw\`…\`` template only.
  No other file. No JS/backend/schema changes for this part.
- Template spans ≈ **lines 45–318.**

The password field is built in three nested controls (current lines):
- `$pwLabel` — caption **"Password"** → lines **170–176** (at `$content` x=24, y=174).
- `$pwFrame` — outer bordered container → lines **178–181** (420×32).
- `$pwInner` — inner white field → lines **183–188** (418×30).
- `$pw` — the masked `TextBox` → lines **190–201**; `Left=6, Top=3, Width=406, Height=24` are **relative to `$pwInner`**.

The controls are parented in the **assembly block** → lines **301–314** (`$pwFrame.Controls.Add($pwInner)`; `$pwInner.Controls.Add($pw)`; `$content.Controls.Add($pwFrame)`; `$panel.Controls.Add($content)`).

The card container / centering comes from:
- `$panel` frame 472×388 → lines **87–90**; `$content` 470×386 → lines **92–97**.
- Centering `Add_Shown` → lines **109–114** (centers `$panel` on the form).

## 3. Inspect first (do not guess)

1. Confirm the **full parent chain** is intact so no control escapes its content container:
   `$pw` → `$pwInner` → `$pwFrame` → `$content` → `$panel` → `$form`.
   The likely root cause of "field at the very top" is that the `$pw` `TextBox` (or the
   whole `$pwFrame`) is landing on the wrong parent (e.g. added to `$form`/`$panel` directly
   or added before layout) so its absolute `Top` resolves against the wrong origin.
2. Confirm `Left`/`Top` of `$pwFrame` are set to content coordinates (**24, 204** region) and
   that `$pw` uses coordinates **relative to `$pwInner`** (6,3) — TextBox coordinates are
   relative to its direct parent; if `$pw` is a direct child of `$content`/`$form` instead,
   those small values would throw it up to the top-left and overlap the header. **This is the
   exact thing to check first.**
3. Confirm z-order: the header (`$shield`/`$heading`, ~lines 117–130), separator `$sep`
   (133–138), and status row (141–155) must be added to `$content` in rear-to-front order and
   must sit above `$pwFrame` in the coordinate space of `$content`.

## 4. Requirements

1. The password input must render **directly underneath the "Password" label**, inside the
   main content area of `$content` — never overlapping/near the "Windows Security" header.
2. The `TextBox` must be a child of `$pwInner` only (its intended content container); no input
   element may be accidentally parented to the form or the header area.
3. One clean field: `$pwFrame` (the visible 1px border) → `$pwInner` (white) → `$pw` (masked),
   with `Left/Top/Width/Height` consistent so the TextBox sits inset inside the frame.
4. Keep `UseSystemPasswordChar = $true`, `MaxLength = $pinLen`, and the digits-only
   `$pw.Add_KeyPress` filter (lines 198–201) unchanged.
5. Keep `$pw.Width` small enough to stay inside `$pwInner` (e.g. ≤ ~406) so it never overflows.

## 5. Do NOT change for this part

- Backend, auth, crypto, route, schema (Part 40 may only *remove device-user text*, never the
  POST/logic).
- The Unlock button styling (Part 38), card width/height (Part 39), or message strings (Part 40).
- The submit logic inside `$unlock.Add_Click` (lines 236–292).

## 6. Verification

- `npx tsc --noEmit`, `npx eslint lib/request-unlock.ts`, `NODE_ENV=production npm run build`.
- Live on a real Windows interactive session: open the modal → the masked field must appear
  directly under the **Password** label in the content area, clearly below the header, masked,
  and focusable. It must not overlap "Windows Security" at any resolution (768p and 4K).
- Typing digits still gates the Unlock button exactly at `$pinLen`.

## 7. Commit & push

- Commit only `lib/request-unlock.ts` with a clear message, e.g.
  `Fix password field layout in credential request UI (Task 37)`.
- Push to `origin/main`. Report commit hash, files changed, and tsc/build results.
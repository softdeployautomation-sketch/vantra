# Task 39 — Compact the modal & enforce the alignment/responsive layout

**Status: ready to implement.** Written 2026-09-11 by Cline (bug report → split, Part 3 of 4).

> Same single-file bug fix as Tasks 37/38/40. Do 37 & 38 first so the field layout and button are
> settled before you resize the card. One focused commit.

## 1. The bug

The modal is **too large** — the card has excessive empty space, especially below the password
field — and overall alignment drifts from this intended layout:

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

- **File:** `lib/request-unlock.ts` — `PROMPT_SCRIPT` template only.
- Current card size:
  - `$panel` frame **472×388** → **lines 87–90**.
  - `$content` **470×386** → **lines 92–97**.
- Centering (already correct — keep it): `$form.Add_Shown` → **lines 109–114**.
- Element coordinates (all inside `$content`, left/right padding 24):
  - shield `$shield` (117–122), title `$heading` (124–130), separator `$sep` (133–138),
  - status dot/`Device locked` (141–155), instruction `$hint` (158–166),
  - field label `$pwLabel` (170–176), field frame `$pwFrame` (178–181) + inner (183–188) + `$pw` (190–201),
  - button `$unlock` (206–217), feedback label `$resultLabel` (226–234).

## 3. What to change

1. **Reduce overall width and height.** Recommended target ≈ **440–450 wide × ~355–370 tall**
   (keep it tight; the card must stay comfortably readable). Update BOTH `$panel` and `$content`
   together by the same 2px frame difference (frame = content + 2 for the 1px border).
2. **Kill the excess empty space below the password field.** Currently the field sits near
   `Top=204` and the button at `Top=308` with a large bottom gap. Pull the button up so its bottom
   edge is close to the field's bottom edge (align the button's bottom with the field's bottom,
   e.g. button `Top ≈ field bottom − button height + small gap`), and trim `$content.Height`.
3. **Match the intended alignment precisely:**
   - consistent left margin (24) and right margin (24) for all full-width block elements,
   - the field directly under the **Password** label with no overlap and a small gap,
   - the **Unlock** button right-aligned with the field's right edge (button right edge ≈ content
     right edge − 24), not centered over empty space.
   - Recompute every `Top` after resizing so gaps stay uniform (header → divider → status →
     instruction → label → field → button).
4. **Responsive / never clip:** keep the centering `Add_Shown` (109–114). Clamp the card so at
   small 768p it still fits (fixed max height) and at 4K it stays a fixed centered size; the
   card must never exceed `$form.ClientSize` on any target.
5. While resizing, re-verify Task 37's guarantee: the password input stays inside its content
   container (`$pw` inside `$pwInner` inside `$pwFrame` inside `$content`).

## 4. Do NOT change for this part

- The Unlock button styling choices (Task 38) — only move/resize it as required by the layout.
- The submit/POST logic, messages (Task 40), backend.
- The exact required wording (Windows Security / Device locked / instruction / Password / Unlock).

## 5. Verification

- `npx tsc --noEmit`, `npx eslint lib/request-unlock.ts`, `NODE_ENV=production npm run build`.
- Live Windows at **768p and 4K**: card is smaller, centered, no clipping, uniform margins, the
  button aligned to the field's right edge, no large empty band below the field.

## 6. Commit & push

- Commit only `lib/request-unlock.ts`:
  `Compact and align credential request UI (Task 39)`.
- Push to `origin/main`. Report commit hash, files changed, and tsc/build results.
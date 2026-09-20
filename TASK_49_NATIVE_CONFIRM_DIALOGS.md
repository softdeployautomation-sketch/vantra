# Task 49 — Native browser `confirm()` dialogs break the app's look everywhere they appear

**Status: ready to build. Owner-requested 2026-09-21** (reported live: "vantra.instaweb.top says / Switch back to web?..." and "vantra.instaweb.top says / Clear this license's device binding?..." — both are the browser's own native confirm dialog, not a styled in-app one).

## The gap

Five places in this app use the raw browser `window.confirm(...)` instead of a styled in-app dialog:

- `components/desktop-mode-banner.tsx:22` — "Switch back to web? This revokes your Vantra Desktop license..."
- `components/desktop-lock-screen.tsx:20`
- `components/admin/admin-devices-client.tsx:102`
- `components/admin/admin-exe-licenses-client.tsx:282` and `:312` — "Clear this license's device binding?..."

A native `confirm()` renders as raw, unstyled browser chrome — "vantra.instaweb.top says," ignores the app's dark theme, and looks especially out of place once this ships inside the desktop EXE (Task 44.x), where there's no browser chrome around it to explain why it looks that way. This is purely a UI-consistency bug, not a security issue — but it's a jarring, unprofessional moment for a customer using an otherwise polished app, and worth fixing before the first customer sees it.

## The fix — this is cheap, the building block already exists

`components/modal.tsx`'s `ConfirmDialog` already exists in this repo — no new dialog component needed. What's missing is a shared provider wiring it up as a drop-in replacement for `window.confirm()`.

SpaceWorker's repo (`/Users/mikeolab/spaceworker`) already built exactly this, and its own `ConfirmDialog` was originally copied FROM this repo's `components/modal.tsx` — so porting it back here is a near-verbatim copy, not a new design:

1. Add `components/confirm-provider.tsx` (copy SpaceWorker's file at that same path, adjust imports if the `Modal`/`ConfirmDialog` export shape differs at all — check `components/modal.tsx` here first): a `ConfirmProvider` + `useConfirm()` hook that returns a Promise<boolean>, rendering the app's own `ConfirmDialog` instead of the browser's native one.
2. Mount `<ConfirmProvider>` once at the root layout (`app/layout.tsx`), the same way SpaceWorker mounts it next to its `ToastProvider`.
3. Replace all 5 `window.confirm(...)` call sites above with `await confirm({ title, description, confirmLabel, confirmVariant })` from `useConfirm()` — each site already has the confirmation message as a string; split it into a short `title` and the fuller explanatory `description` the same way SpaceWorker's admin panel does it (see e.g. `WorkerControlPanel`'s "Stop worker & pause all runs?" call in that repo for the exact shape to match).

## Verification expected

- `npx tsc --noEmit` clean.
- Live: trigger each of the 5 flows (switch to web, desktop lock screen action, admin device action, admin license clear-binding ×2) and confirm a styled in-app dialog appears instead of the browser's native "vantra.instaweb.top says" popup, in both light and dark theme.
- Confirm Cancel and Confirm both still behave identically to before (the underlying action only fires on confirm, exactly as the native dialog did).

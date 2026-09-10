# Task 28 — Remove "Connect with input suspended" (pre-connect option)

**Status: ready to implement.** Written 2026-09-10 by Cline (follow-up to Task 27).

## 1. Goal

Remove the **pre-connect** option titled **"Connect with input suspended"** from
the Control tab of the remote-tools UI. Keep the existing in-console
input-suspension (Suspend/Resume) working.

## 2. Critical nuance — same mode, two surfaces (read before deleting)

In `components/remote-tools.tsx`, "input suspended" is implemented as
`ConnectMode = "viewonly"`. That one mode is used by **two** different surfaces,
and only ONE of them must go:

- **(a) REMOVE** — the pre-connect card in `ConnectChooser`:
  `title="Connect with input suspended"` which calls `onViewOnly` (≈line 223-228).
  This is the redundant "separate connection option".
- **(b) KEEP** — the in-console **Suspend input / Resume input** entry in the
  post-connect Tools menu (`id: "toggle-input-suspend"`, ≈line 868-874) and the
  passive status pill ("Input suspended" / "Full control", ≈line 959-971), plus
  the view-only rendering/guards (the `realViewOnlyBlock` / `softGuard` / `controlSrc`
  logic and the MeshCentral view-only URL minting).

So you are removing the *way a session is **started** in view-only mode*, not the
*ability to be in view-only mode* mid-session. Do not delete the `viewonly`
machinery itself.

## 3. Why the redundancy exists (context)

The chooser card was added to expose "view-only" as a first-class connect option,
but the same capability already exists once inside a session: the Tools menu's
**Suspend input** toggle. That overlaps and clutters the chooser, so the card is
unnecessary. Removing it leaves the console's own input-suspension as the single
path.

## 4. Requirements

1. Remove the "Connect with input suspended" `ConnectOption` card from
   `ConnectChooser`.
2. Remove the now-unused `onViewOnly` prop/parameter of `ConnectChooser` and the
   call site that passes it (`onViewOnly={() => setConnectMode("viewonly")}`),
   unless you keep a way to reach view-only. Decide deliberately: see §5.
3. Do **not** break: the in-session Suspend/Resume toggle, the status pill, the
   view-only rendering/guards, or the `viewonly` ConnectMode state transitions
   still reachable from the Tools menu.
4. Remove unused frontend code only where it is now dead (no references). Do not
   churn shared helpers.
5. Backend: only remove API calls/logic **exclusively** used by this option. Before
   touching `app/api/devices/[agentId]/mesh/view-only/*` (the MeshCentral view-only
   URL minting), verify whether the in-console Suspend still consumes it — if it
   does, KEEP it. Inspect `lib/meshcentral-api.ts` and the mesh routes first.

## 5. Decide + document the view-only entry point

Because a technician can still want to start a session and immediately be in
view-only, choose ONE of these and make it explicit in the code + this doc:

- **A)** After removing the card, a session always starts in full control; the tech
  switches to input-suspended via the Tools menu (the existing toggle). Simplest,
  matches "the console already provides the ability to suspend input directly on
  screen".
- **B)** Keep a lighter secondary affordance elsewhere. Only do this if you find the
  removal genuinely degrades a real workflow.

Recommend A. If you pick B, keep it minimal and staff-only consistent with the
console.

## 5.1 Decision recorded (implemented 2026-09-10)

**Chose A.** After removing the card, a session always starts in full control;
the technician reaches input suspension in-session via the Tools menu's
existing **Suspend input / Resume input** toggle. No secondary affordance was
added. The in-session `viewonly` machinery (the `realViewOnlyBlock` /
`softGuard` / `controlSrc` guards, the passive status pill, and the MeshCentral
view-only URL minting) is unchanged and remains the single path.

## 6. Files to inspect / change

- `components/remote-tools.tsx` — `ConnectChooser` (remove card + `onViewOnly`
  prop), its call site, and the `ConnectMode` flow. Verify the Tools-menu
  `toggle-input-suspend` and the pill remain wired.
- `app/api/devices/[agentId]/mesh/view-only/...` + `lib/meshcentral-api.ts` —
  inspect before any deletion; likely KEEP because the in-console Suspend depends
  on it.
- Do not change `lib/agent-route.ts` or credential code for this task.

## 7. Verification

- `npx tsc --noEmit`, `npx eslint`, `NODE_ENV=production npm run build`.
- The Control tab chooser no longer shows "Connect with input suspended".
- Starting a normal connect → in-session **Suspend input** and **Resume input**
  still work, and the status pill still reflects the mode.
- Non-staff still see only the plain remote-control options, and Backstage remains
  staff-only (unchanged).

## 8. Commit & push

- Remove debug/temp files. Commit with a clear message. Push to the existing remote
  `origin/main`. Check the post-push Actions build.
- Report branch, commit hash, files changed, tsc/build results, and your §5 decision.
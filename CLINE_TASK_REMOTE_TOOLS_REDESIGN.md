# Cline Task — Remote Tools Redesign: 3 Connect Options, Tab Reorder, Post-Connect Options Menu

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code only.

## Vocabulary — read this first, it's used inconsistently elsewhere and this is the authoritative mapping

Per the user, directly: **"user" = the technician** operating Remote Tools. The device's actual owner (the person physically at that computer) is **"guest"** for the duration of a session — the technician is effectively "the admin" of the session, the device owner is the "guest." Where earlier session notes said "stop guest input" they meant blocking the *device owner's* local input; where this task says "connect with the user's input taken off" it means the **technician's own** remote input (i.e., the existing view-only toggle Cline already built and Claude hardened — `viewOnly` state in `components/remote-tools.tsx`, `controlViewOnly` from `/api/devices/[agentId]/mesh/view-only`). Don't conflate the two — this task is only about the technician's own input.

## Confirmed live findings (don't re-derive)

- MeshCentral's regular Control connection (via TRMM's existing token flow, `viewmode=11`) does **not** appear to force a consent/notification popup on the guest's screen — checked `/meshcentral/meshcentral-data/config.json`, no `userconsentflags` set at the domain level, and `meshuser.js`'s consent-flag assembly (`command.consent = 0; ... |= domain/mesh/node/user consent`) has nothing forcing it on. If this task's manual testing (see Verification) finds otherwise, fix it there — but the code-level evidence says the base connect path is already silent.
- **The one place a notification IS currently forced**: `lib/meshcentral-api.ts`'s `createShareLinkOnSocket` hardcodes `consent: 0x0001` (notify) when minting the view-only share link. **Change this to `consent: 0` before building anything else in this task** — every connection must be silent/anonymous by default per the user's explicit instruction ("no one should be notified for every connection... it has to work anonymously"), and this is a real, known bug, not something to investigate further.
- "Backend" in the 3-connect-options list below refers to the **existing Backstage panel** (`components/backstage.tsx` — PowerShell/cmd/process list/services/software, already built in a prior session pass), **not** a new MeshCentral connection mode. This task surfaces it as a top-level connect option; it does not build new Backstage functionality.

## Changes, in order

### 1. Tab order: Terminal first, Control last
Currently `["control", "terminal", "file"]` in `components/remote-tools.tsx`. Change to Terminal, Files, Control (or Terminal, Control, Files — user said "Control last" and "Terminal first," didn't specify where Files goes; put Files in the middle since it wasn't mentioned as needing to move). Update wherever this order is defined (the tab button row and any place that assumes `activeTab`'s default).

### 2. Remove "FULL CONTROL" badge/label
The badge showing "FULL CONTROL" (visible in the screenshot, next to the "Full control" mode indicator) gets removed — per the user: "admin are aware they can have full control," no need to announce it. Keep whatever *minimal* indicator is still needed to distinguish view-only vs. full-input state (e.g., the existing colored dot / "View-only"/"Full control" toggle button label can stay, since that's a functional control, not a redundant announcement) — just drop the separate all-caps "FULL CONTROL" badge specifically.

### 3. Move "Start maintenance screen" out of the main toolbar, into a new post-connect options menu
Currently a button in the same row as "Open in new tab" and the view-only toggle, visible before/during connection. Move it into a **new menu** that appears *after* connecting — per the user, this menu should be designed to hold **multiple different tools/options going forward**, not just maintenance-overlay start/stop. Build it as a real extensible menu (a dropdown or a small panel — your call on the exact widget, but the data structure backing it should be a list of actions, not a single hardcoded button), with "Start/Stop maintenance screen" as its first entry. This is where future post-connect tools get added later, so don't hardcode it to just one action.

### 4. The Control tab: exactly 3 connect options, nothing else
Per the user's explicit list, the Control tab's *pre-connect* state should offer exactly:
1. **Connect to device** — the normal full-control connection (today's default `mesh.control` iframe load).
2. **Connect to Backend** — jumps to/embeds the existing Backstage panel (`components/backstage.tsx`) instead of the MeshCentral desktop iframe. Since Backstage is already built and already rendered elsewhere on this same page (per the device-detail layout), this is likely a matter of making it reachable as a first-class Control-tab option rather than a separate always-visible section — check how it's currently mounted (`components/agent-detail-client.tsx` per earlier session context) and decide whether to move it or just add a shortcut/tab-within-tab that scrolls to/reveals it. Use your judgment on the cleanest implementation, the requirement is that it's one of the 3 explicit choices presented, not that the underlying Backstage component itself needs rebuilding.
3. **Connect with [technician's] input taken off, with an option to grant it back** — this is the existing view-only feature. Present it as a genuine third *connect* choice (not a toggle you flip after already being connected in full-control mode) — i.e., the technician picks this up front if they want to start view-only, same as picking "Connect to device" starts them full-control. The existing toggle-back-to-full-control behavior stays (that's the "option to grant it back" part) — this task is about how the *initial* choice is presented, not removing the ability to switch mid-session.

## Verification

1. Confirm `consent: 0` actually results in no popup/notification on a real connected test agent when a view-only share link is used — this is the one item flagged as "should already be silent but verify" for the base connect path too; test both.
2. Confirm the 3 connect options are the only pre-connect choices shown on the Control tab, and each does what it says (full control / Backstage / technician-input-off-with-restore).
3. Confirm Terminal is the first tab shown by default, Control is last.
4. Confirm the "FULL CONTROL" badge is gone but the technician can still tell which mode they're in.
5. Confirm the maintenance-overlay start/stop still works correctly from its new post-connect menu location, and confirm that menu's structure would sensibly accept a second unrelated action added later (a quick sanity check, not a full second feature).

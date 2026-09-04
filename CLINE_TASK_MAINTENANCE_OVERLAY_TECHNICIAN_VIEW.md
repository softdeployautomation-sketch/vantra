# Cline Task — Maintenance overlay blanks the technician's own view too (needs a decision before building)

**Repo**: `/Users/mikeolab/vantra`. **Scope**: needs a real architectural decision before any code — read this whole doc before starting, this is NOT a straightforward implementation task.

**Reported bug, verbatim**: "when i click maintenance mode, it shows on the guest pc which is the owners pc which is right, but it also showed in our own tool the technician tool, it blanks ours also and wont let technician fix."

## Why this isn't a simple fix

The maintenance overlay (`lib/maintenance-overlay.ts`) works by launching a real fullscreen borderless window **on the remote device's own physical desktop** (a WinForms black screen reading "Working on updates / Don't turn off your computer", started/stopped via `sendRawCmd`). This is by design — it's meant to visually cover whatever the customer would otherwise see on their own monitor while a technician works.

The Remote Tools "Control" view (MeshCentral) works by **mirroring that same real desktop** to the technician's browser. There is no separate "channel" — MeshCentral shows whatever is actually rendered on the remote machine's screen. Since the overlay window is a real, fullscreen, topmost window running ON that machine, **it is the actual desktop content** at that moment — MeshCentral has no way to show the technician something different from what's really on screen, because nothing else is being asked to render. This is why toggling the overlay on blanks the technician's own view too — it isn't a bug in the sense of "wrong code path," it's the overlay doing exactly what it was built to do (cover the real desktop), applied to the only screen that exists.

## The two realistic paths forward — a decision is needed here, not a guess

1. **Accept the limitation, fix the workflow instead.** The existing Tools menu already has "Start maintenance screen" / "Stop maintenance screen" as two separate, independent actions specifically so a technician can stop the overlay to work, then restart it when stepping away. If this is the real intent, this task becomes: confirm the stop/start toggle is fast and reliable enough for the workflow (start it before/after doing visible work on the machine, stop it to actually work), and maybe add a clearer in-UI reminder ("Overlay is currently ON — the guest and this view both see the maintenance screen") so a technician doesn't get confused mid-session like this bug report describes. **No architecture change, small UI clarity fix only.**
2. **Build a genuinely separate technician-only view that bypasses the overlay.** This would require NOT relying on MeshCentral's screen-mirror for the technician while the overlay is up — e.g., a second, independent input/inspection channel (blind terminal commands, or a completely different remote-control mechanism that doesn't render through the visible desktop at all) that works *while* the overlay covers the physical/mirrored screen. This is a real, non-trivial R&D task, not a quick build — it likely needs its own research pass into whether MeshCentral (or an alternative) supports any kind of "hidden virtual desktop" / "input session 0 vs session 1" split that Windows itself might offer (Windows does have the concept of multiple sessions, but TRMM/MeshCentral's existing integration doesn't currently expose "control a different session than the one being displayed").

**Do not start building option 2 without explicit confirmation this is worth the R&D investment** — option 1 is a same-day fix; option 2 could be a multi-day-or-more investigation with no guaranteed feasible outcome. Flag back with findings on Windows multi-session support if asked to investigate option 2, rather than committing to a build before knowing it's possible.

## What to do right now (regardless of which path is chosen later)

Add a clear on-screen indicator in `components/remote-tools.tsx`'s Control tab whenever the overlay is currently ON — a persistent banner (not just the Tools-menu list item's label) so a technician glancing at the screen understands *why* it looks blank, rather than assuming something is broken. This is useful under either path above and is a small, safe, immediate fix.

## Verification

1. Start the overlay, confirm the new banner appears clearly in the Control tab.
2. Stop the overlay, confirm the banner disappears and the technician's view returns to the real desktop.
3. Do not attempt to verify "guest sees fake screen, technician sees real screen simultaneously" — per the above, that isn't achievable with the current architecture without a separate R&D decision.

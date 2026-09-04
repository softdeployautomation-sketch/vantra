# Plan — Private Technician Session (staff-only, premium-only maintenance mode)

**Status: PLAN ONLY — nothing built yet.** Captured here so it isn't lost while the GitHub account migration is in progress. Do not hand this to Cline as-is; see "How this gets built" below — the native Windows capture/injection piece needs to be written/reviewed by Claude directly before any of it is deployed.

## Why this exists

The existing "Start maintenance screen" feature (`lib/maintenance-overlay.ts`, wired through `components/remote-tools.tsx`'s Tools menu) shows a fake "Working on updates" screen on the guest's machine, but it's a screen-mirroring overlay — MeshCentral's remote-desktop capture follows whatever Windows considers the "current input desktop," so the technician's own remote view goes blank too, the same moment the guest's does. This was root-caused by reading MeshAgent's actual capture source (`meshcore/KVM/Windows/kvm.c`'s `CheckDesktopSwitch`, which explicitly calls `OpenInputDesktop()` every frame) — it's not a bug, it's necessary so the technician's view correctly follows real UAC/lock-screen transitions. Patching that out would break that legitimate behavior and mean forking/maintaining MeshAgent forever.

The real fix needs a second, independent desktop object: switch the guest's *visible* desktop to a decoy carrying the overlay, while a separate, purpose-built process stays pinned to the real desktop and keeps capturing + controlling it for the technician. This is a real, working Windows technique (confirmed via Microsoft's own `SwitchDesktop`/`CreateDesktop` docs and real-world precedent) — but the same mechanism is also the core technique behind HVNC (Hidden VNC) malware, which hides a remote operator's actions from a victim. That's why this is being built as a **staff-only, premium-gated technician capability inside Vantra** (not a customer self-service feature, not shipped as a generic capability) — the access model below is the mitigating control, not an afterthought.

## Rollout phases (per the user's explicit sequencing)

1. **Phase 1 — build + internal test.** Build the feature, gate it to Premium orgs, and validate it end-to-end against our own existing test accounts/orgs (Sblast, Mblast, Michael Test Org — already premium per earlier grants) and the real Windows test agent. No real paying customer sees this during Phase 1.
2. **Phase 2 — permanent gating.** Once validated, the feature stays gated to **`user.isStaff === true` AND the target device's owning Organization has `plan === "premium"`** — never a plain customer self-service action, regardless of their own plan. A premium customer's Remote Tools tab keeps working exactly as it does today (existing overlay, existing limitations); this new capability is a *staff-only* addition on top, for when Vantra's own technicians are actively servicing a premium customer's device.

## Architecture

1. **Trigger**: a new "Start private technician session" action, staff-visible only, likely surfaced in `components/remote-tools.tsx`'s Tools menu alongside (not replacing) the existing "Start maintenance screen" entry.
2. **Delivery mechanism — reuse the existing pattern, no new agent/installer.** The current overlay is already delivered as a one-shot PowerShell script (with embedded C#/WinForms via `Add-Type`) sent through `sendRawCmd`/TRMM's `runscript`, launched detached (`Start-Process -WindowStyle Hidden`), `run_as_user: true` (needed because TRMM's agent runs as SYSTEM/session 0, which can't render UI on the interactive user's desktop at all — this is a session-isolation restriction, not a privilege one; SYSTEM is already higher-privileged than Administrator). The new capability should follow the exact same delivery shape: a script that
   - Creates a new desktop object (`CreateDesktop`, e.g. `VantraTechSession`) in the same window station.
   - Launches the existing overlay UI onto *that* desktop (reuse the current WinForms overlay code, just point its launch at the new desktop instead of the current one).
   - Launches a second, small companion process *before* switching desktops, while still attached to the real one — pinned via `OpenDesktop("Default", …)` + `SetThreadDesktop()`, doing steady BitBlt capture and `SendInput`-based control against it. This is the technician's real, live, working view.
   - Calls `SwitchDesktop()` last, to make `VantraTechSession` the one physically shown to the guest/console/any normal remote session.
   - "Stop" reverses it: switch back to `Default`, tear down the decoy desktop and the companion process.
3. **Transport for the companion process's capture/input stream**: reuse the existing agent tunnel plumbing (the same mechanism that already exposes MeshCentral remotely) pointed at a different local port the companion process binds, rather than building new relay infrastructure from scratch.
4. **Safety net (non-negotiable, build this alongside the feature, not after)**: if the companion process crashes or the technician's browser disconnects uncleanly, the device must never get stuck showing the decoy screen forever. Needs a watchdog/timeout (e.g. the agent-side script self-monitors and force-switches back to `Default` after N minutes of no heartbeat from the companion process) — this is the single most important failure mode to design against before shipping.
5. **Audit log**: every start/stop of a private technician session must be logged (who, which device, which org, start/stop timestamps) — reuse the same audit-trail discipline already applied to device-transition notifications and payment review actions this project. This is the concrete accountability control that makes "staff can work invisibly on a customer's device" defensible — there must always be a clear record of who did it and when.

## Open technical question to resolve before building the authz gate

Every existing premium-gated route (`lib/agent-route.ts`'s `authorizePremiumAgentAction`/`authorizePremiumDeviceAction`) checks the **caller's own active organization's** plan. That doesn't work here: staff bypass ownership entirely (they can act on *any* customer's device), so for this feature we need to check the plan of the **target device's owning Organization**, not the staff member's own org. This requires a reverse lookup (agentId → owning Organization → its `plan`) that doesn't fully exist yet — `listAgents()` returns TRMM's own `client_name`/`site_name` strings per agent, not a direct foreign key to our `Organization.id`. Resolve this by matching the agent's TRMM client id (confirm `getAgentDetail`/`listAgents` actually expose a numeric client id, not just a name string — verify against the real API rather than assume) against `Organization.trmmClientId` in our DB. Write a new `getOrganizationForAgent(agentId)` helper in `lib/authz.ts` or `lib/session-user.ts` once this is confirmed, and build the new gate (e.g. `authorizeStaffPremiumTechnicianAction`) on top of it, mirroring the shape of the existing `authorizePremiumAgentAction`.

## Before writing the full pipeline — validate the one real unknown first

Some Windows internals sources suggest DWM composition behaves differently for a desktop that isn't the currently-active one, which could mean modern, hardware-accelerated UI (browsers, the Settings app) doesn't render correctly on the "parked" real desktop once we've switched away from it. This needs a cheap, standalone validation spike (create a second desktop, switch to it, confirm via BitBlt from the original desktop that ordinary apps still render and respond correctly) on a real Windows test agent, **before** committing to building the full companion-process/transport pipeline. Do this spike first.

## How this gets built — do not hand this whole thing to Cline blind

- **Claude writes/reviews the native Windows pieces directly**: the desktop-creation/switching script, the companion capture+input process, and the validation spike. This is novel, failure-prone, low-level Windows work where a subtle mistake (e.g. a botched watchdog) could strand a real device on a blank decoy screen — not something to delegate on a prose spec alone.
- **Cline can safely handle the surrounding wiring** once the native piece is proven working on a real test agent: the new Tools-menu entry, the API routes, the new authz gate, the audit-log table/UI, and the admin-visible activation history — with an exact, concrete spec from Claude (file paths, function signatures, request/response shapes), the same way every other Cline task in this repo is written.

## Repo location

Stays in this repo (`/Users/mikeolab/vantra`) — not a separate internal-tools repo. The account migration to `softdeployautomation-sketch` (in progress separately) will carry this file and any resulting code along with everything else.

## Explicitly not decided yet / do not assume

- Exact UI copy/placement of the new Tools-menu entry.
- Whether the companion process's transport is a raw custom protocol or an adapted open-source .NET VNC server library — pick whichever is less code to get right, decide once the validation spike is done.
- Whether this ever gets a customer-facing announcement at all (per the phased rollout above, it's plausible this never becomes customer-visible — it may just be an internal support capability staff use without the customer necessarily being told it's happening beyond the existing "maintenance in progress" framing).

# Task 18 — Pull Terminal + Files out of the tab bar, make Terminal a real command form (with queueing)

**Status: ready for Terminal; Files needs one spike first (see Phase 2).** Written 2026-09-08 directly from a screenshot of the live Remote Tools page and the user's own complaint about it.

## The complaint, and what's actually causing it

Today's "Remote access" card (`components/remote-tools.tsx`) has three tabs: **Terminal**, **Files**, **Control**. Confirmed by reading the code — Terminal and Files are **not** the command-runner form they look like they should be; they're raw MeshCentral web sessions embedded in an iframe (`terminalSrc`/`fileSrc`, resolved from `mesh.terminal`/`mesh.file` — full MeshCentral URLs TRMM hands back). Switching to either tab immediately loads a live MeshCentral session in an iframe — that's the "showing the console on every tab load" the user is pointing at. It's a live remote session chrome, not a simple form.

**The actual command-runner form the user is asking for already exists** — it's just not exposed here. `remote-tools.tsx` builds a `terminalPanel` (shell dropdown: cmd/powershell, a timeout field, a command input, a "Run as the logged-in user" checkbox, a Run button, output shown below) and passes it into `<Backstage agentId={agentId} terminal={terminalPanel} />`, only reachable via **Control → "Connect to Backend."** This task is largely about **promoting that existing form to its own top-level section** rather than building a new one, plus adding the queueing capability the user asked for on top of it.

## Confirmed current architecture (don't re-derive, build on this)

- `components/remote-tools.tsx`: tab bar `["terminal", "file", "control"]`, `activeTab` state. Terminal/Files resolve straight to MeshCentral iframes. Control shows a 3-way pre-connect chooser (Connect to device / Connect with input suspended / Connect to Backend) then transitions into the corresponding session.
- The `terminalPanel` JSX (lines ~417-451) is fully built and working — shell/timeout/command/runAsUser/Run/output — currently only rendered inside `<Backstage>` when `connectMode === "backend"`.
- `lib/trmm.ts`'s `sendRawCmd()` is the underlying call `runCommand()` (in `remote-tools.tsx`) hits — synchronous, needs the agent to be online and connected right now (it's a NATS round-trip to the live agent).
- `app/api/internal/telegram-device-check/route.ts` already has the exact online/offline **transition-detection pattern** needed for queueing: `wasOnline = prev?.lastStatus === "online"`, `isOnline = agent.status === "online"`, firing a notification specifically on the flip. This is the natural, already-proven hook point to also fire any queued commands the moment a device comes back online — reuse this timer, don't build a second poller.
- No file-listing/file-browsing TRMM API wrapper exists anywhere in `lib/trmm.ts` today — Files has only ever been the MeshCentral iframe. See Phase 2.

## Phase 1 — Terminal section (clear scope, build this first)

1. **Remove `"terminal"` from the tab bar** in `remote-tools.tsx` (`activeTab` becomes `"file" | "control"` for now — Files gets its own treatment in Phase 2, possibly also removed from the tab bar at that point). Delete the now-dead `terminalSrc` resolution and its MeshCentral-iframe rendering branch for Terminal specifically.
2. **Extract `terminalPanel` out of being Backstage-only.** Render it as its own always-visible page section (sibling to the "Remote access" card and "Toolbox," matching the screenshot's existing page layout — `Remote Tools` heading → `Remote access` card → new `Terminal` card → `Toolbox`). It should work **standalone**, not gated behind first picking "Connect to Backend" — the whole point is removing that extra step.
3. **Decide on the Backstage duplication**: now that Terminal is a top-level section, `<Backstage agentId={agentId} terminal={terminalPanel} />`'s own terminal tab becomes redundant. Recommend: stop passing `terminal={terminalPanel}` into Backstage and remove/hide that tab there, rather than maintaining two copies of the same form. **Confirm this with the user before removing Backstage's terminal tab** — flagging rather than assuming, in case Backstage's terminal is used for something the top-level extraction doesn't cover (e.g., a different default context inside the admin-tooling view).
4. **New: "Run now" vs. "Queue until online."** When the target agent is currently online, behavior is unchanged (Run fires `sendRawCmd` immediately, same as today). When the agent is **offline**, replace the Run button's disabled state (or whatever currently happens when you try to run against an offline agent — check this live, it may currently just error) with a **"Queue for when it comes online"** option:
   - New Prisma model:
     ```prisma
     model QueuedAgentCommand {
       id            String   @id @default(cuid())
       agentId       String
       userId        String
       user          User     @relation(fields: [userId], references: [id])
       shell         String   // "cmd" | "powershell"
       cmd           String
       timeoutSeconds Int
       runAsUser     Boolean  @default(false)
       status        String   @default("queued") // "queued" | "sent" | "failed" | "cancelled"
       createdAt     DateTime @default(now())
       sentAt        DateTime?
       error         String?
       @@index([agentId, status])
     }
     ```
   - New route `app/api/devices/[agentId]/queue-command/route.ts` — same auth/ownership gate as every other per-agent route (`assertAgentBelongsToClient`/staff bypass, matching `cmd/route.ts`'s existing pattern), creates a `QueuedAgentCommand` row.
   - New route `app/api/devices/[agentId]/queue-command/[queueId]/route.ts` (`DELETE`) — lets the user cancel a still-queued command before it fires.
   - Extend `telegram-device-check`'s existing online-transition branch: right where it currently detects `!wasOnline && isOnline`, also look up any `QueuedAgentCommand` rows for that `agentId` with `status: "queued"`, and fire each through the same `sendRawCmd` call `cmd/route.ts` already uses, updating `status`/`sentAt`/`error` per the result. This piggybacks on a timer that's already running every few minutes — no new timer/cron needed.
   - UI: the Terminal section shows a small "Queued commands" list (cmd, shell, queued-since, a Cancel button) below the Run form when there are any for this agent, so a queued command isn't just fired-and-forgotten with no visibility.
5. **Explicitly out of scope for Phase 1**: any kind of exact scheduling ("run at 3pm") — the user asked for "queue and time it for when it comes online," which reads as *triggered by the online transition*, not a calendar-time scheduler. If a literal time-of-day scheduler turns out to be wanted too, that's a separate, later task — don't build it speculatively here.

## Phase 2 — Files section (spike first, then build)

**Do not start building UI for this until the spike below is done** — unlike Terminal, there's no existing non-iframe alternative to build on, and the right approach depends on an answer we don't have yet.

**The open question**: does TRMM/MeshCentral's `file` URL (from `getMeshCentralUrls()`) support a query parameter or fragment that pins the file browser's starting directory to root, or does it always open wherever MeshCentral's own UI defaults to? This needs a live check against a real connected agent (`getMeshCentralUrls(agentId).file` on an online test device — the Windows agent installed earlier this session works for this) — inspect the actual URL TRMM returns and, if possible, MeshCentral's own source/docs for a start-path parameter, before deciding between:

- **Option A (cheap)**: if a start-path override exists, keep using the MeshCentral file iframe for the new Files section, just force it to open at root every time instead of wherever it currently lands — this directly addresses "not the way it's currently showing" (the iframe UI itself might be fine; the complaint may just be about the inconsistent/non-root starting location) with a small change.
- **Option B (bigger)**: if no such override exists, build a lightweight, TRMM-native file browser instead of embedding MeshCentral's own file UI at all — this needs its own new TRMM API research (does TRMM's agent API expose any file-listing endpoint at all, separate from MeshCentral?) and is real new-feature work, not a small fix. Scope this as its own follow-up task once the spike answers which path is real.

Report back what the spike finds before writing Phase 2's real implementation plan.

## Verification (Phase 1)

1. `npx prisma generate` + `npx tsc --noEmit` + `npm run build` clean.
2. Visit a device's Remote Tools page: confirm the "Remote access" card no longer has a Terminal tab, confirm a new standalone Terminal section is visible without needing to pick "Connect to Backend" first.
3. Run a command against an **online** test agent from the new section — confirm it behaves identically to today's Backstage terminal panel (same output, same timeout/runAsUser behavior).
4. Queue a command against an **offline** test agent (power it off first) — confirm it's stored, shows in the "Queued commands" list, and can be cancelled. Power the agent back on and confirm, within one `telegram-device-check` cycle, the queued command actually fires and its status updates to "sent" (or "failed" with a real error if something's wrong) — don't just trust the code compiles, watch a real queued command execute.
5. Confirm a **different customer's** agent can't be targeted by `queue-command` (same ownership check as every other per-agent route) — quick IDOR-style spot check, matching this session's established discipline for every new per-agent route.

# Task 18 — Pull Terminal + Files out of the tab bar, make Terminal a real command form (with queueing)

**Status: Phase 0 and Phase 2 applied together (VPS patch); Phase 1 built, reviewed, and deployed.** Written 2026-09-08 directly from a screenshot of the live Remote Tools page and the user's own complaint about it. Updated same day after live-connecting to a real test device surfaced a second, related bug (Phase 0), and again after Phase 2's spike turned out to root-cause into the same file as a small fix rather than needing a new build.

## Phase 0 — Fix MeshCentral's own missing auto-connect on deep-link (VPS file, NOT part of this git repo)

**Separate bug from the tab redesign below, found live**: connecting to a real device, the user had to click MeshCentral's own "Connect" button a second time even though Vantra's "Connect to device" had already been clicked. Root-caused by reading the actual deployed MeshCentral source (`/meshcentral/node_modules/meshcentral/views/default3.handlebars` on the VPS — **this file is not part of the `vantra` git repo**, it's a live file inside the self-hosted MeshCentral install):

- Our deep-link URL (`?gotonode=...&viewmode=11`, from `lib/trmm.ts`'s `getMeshCentralUrls()`) is processed by MeshCentral's own `gotoStartViewPage()` function, which calls `gotoDevice(nodeid, viewmode)` to open the right panel **and nothing else**.
- A *different* code path in the same file, `cmaction()` (fired when a user clicks a device inside MeshCentral's own UI, not via a URL), does auto-connect: `if ((panel == 11) && (desktop == null) && (currentNode.agent.caps & 1)) { connectDesktop(null, 3); }` (and the equivalent for terminal/files panels).
- Confirmed by reading the code (not guessed): there is no alternate URL parameter that already triggers this — the URL-driven path genuinely never calls `connectDesktop`/`connectTerminal`/`connectFiles`, unlike the click-driven path.

**This is not a MeshCentral limitation and does not need a fork** — it's one missing block of the exact logic MeshCentral's own code already has elsewhere, applied to a code path that's missing it. Fix: in `gotoStartViewPage()`, right after the `gotoDevice(...)` call in the `args.gotonode != null` branch, add the same auto-connect check `cmaction()` already does:

```js
// CURRENT (around line 5135-5139 of default3.handlebars):
} else if (args.gotonode != null) {
    if (args.gotonode.length == 96) { args.gotonode = btoa(hex2rstr(args.gotonode)).split('+').join('@').split('/').join('$'); }
    if (getNodeFromId('node/' + domain + '/' + args.gotonode) == null) return;
    gotoDevice('node/' + domain + '/' + args.gotonode, xviewmode);
    goBackStack.push(1);
}

// FIXED:
} else if (args.gotonode != null) {
    if (args.gotonode.length == 96) { args.gotonode = btoa(hex2rstr(args.gotonode)).split('+').join('@').split('/').join('$'); }
    if (getNodeFromId('node/' + domain + '/' + args.gotonode) == null) return;
    gotoDevice('node/' + domain + '/' + args.gotonode, xviewmode);
    // Vantra patch: mirror cmaction()'s auto-connect (elsewhere in this file) on
    // deep-link navigation too -- without this, a URL like ours
    // (?gotonode=X&viewmode=11) only opens the panel, leaving a manual "Connect"
    // click required every time despite the customer having already clicked
    // "Connect to device" in Vantra's own UI.
    if (currentNode && (currentNode.conn & 1) && (meshes[currentNode.meshid].mtype == 2)) {
        if ((xviewmode == 11) && (desktop == null) && (currentNode.agent.caps & 1)) { connectDesktop(null, 3); }
        if ((xviewmode == 12) && (terminal == null) && (currentNode.agent.caps & 2)) { connectTerminal(null, 1); }
        if ((xviewmode == 13) && (files == null)) { connectFiles(null); }
    }
    goBackStack.push(1);
}
```

`currentNode` is safe to read here — `gotoDevice()` sets it synchronously before returning (confirmed by reading `gotoDevice`'s own body).

**How this gets applied — flagged explicitly since it's unusual for a task in this repo**: this edits a live file inside the self-hosted MeshCentral npm package on the VPS, not anything tracked by `git` in the `vantra` repo. It cannot go through a normal PR/deploy. Whoever applies it needs SSH access to the VPS, should back up the original file first, restart `meshcentral.service` after editing, and must keep a copy of this exact diff somewhere durable (this task doc is that copy) — **a future MeshCentral version upgrade will silently overwrite this file and undo the fix**, with no error or warning when it happens. Add a one-line note to Vantra's own `README.md` pointing back to this task doc so a future upgrade doesn't quietly regress this.

**Verification**: apply the patch, restart `meshcentral.service`, then from Vantra's dashboard click "Connect to device" on a real online test agent and confirm the remote-desktop session establishes without a second manual click inside the MeshCentral window. Repeat for Terminal (viewmode 12) and Files (viewmode 13) — same missing-auto-connect bug affects both, so this one patch should fix all three from the same tab bar (until Phase 1/2 below replace Terminal/Files with something else entirely).

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

## Phase 2 — Files always opens at root (spike done — small, resolved, same file as Phase 0)

**Status: investigated and applied as part of Phase 0's patch pass — Option A below, confirmed correct.** The open question this section originally posed is answered: MeshCentral's file browser doesn't need a URL start-path parameter at all — it already opens fresh sessions at root (`p13targetpath = ''`). The actual bug is that it then **remembers the last folder browsed per device**, in the browser's own local storage (`getstore('_devFilePaths', ...)`, keyed by `currentNode._id`), and silently jumps back into that remembered path on every subsequent connection — confirmed by reading `onFilesStateChange`'s `case 3` block in the same `default3.handlebars` file Phase 0 patches. That's the whole explanation for "not opening from root": it's not random or broken, it's a "remember where I left off" feature that reads as a bug once more than one technician (or more than one session) touches the same device.

**No Option B needed** — there was never a case for building a TRMM-native file browser; this was always a one-line fix once root-caused. Patch: in the same `case 3:` block, drop the `getstore('_devFilePaths', ...)` lookup entirely and leave `p13targetpath` as the empty string it's already initialized to, so every connection starts at root regardless of history. Applied and deployed together with Phase 0's patch (same file, same restart) — see the combined command in this task's history. The Files **tab** itself (still a MeshCentral iframe on the Remote access card) is otherwise unchanged; nothing here required touching the `vantra` repo.

## Verification (Phase 1)

1. `npx prisma generate` + `npx tsc --noEmit` + `npm run build` clean.
2. Visit a device's Remote Tools page: confirm the "Remote access" card no longer has a Terminal tab, confirm a new standalone Terminal section is visible without needing to pick "Connect to Backend" first.
3. Run a command against an **online** test agent from the new section — confirm it behaves identically to today's Backstage terminal panel (same output, same timeout/runAsUser behavior).
4. Queue a command against an **offline** test agent (power it off first) — confirm it's stored, shows in the "Queued commands" list, and can be cancelled. Power the agent back on and confirm, within one `telegram-device-check` cycle, the queued command actually fires and its status updates to "sent" (or "failed" with a real error if something's wrong) — don't just trust the code compiles, watch a real queued command execute.
5. Confirm a **different customer's** agent can't be targeted by `queue-command` (same ownership check as every other per-agent route) — quick IDOR-style spot check, matching this session's established discipline for every new per-agent route.

# Plan — Forking MeshCentral (and, eventually, our own remote-access stack)

**Status: fork created 2026-09-09, sandbox setup not yet started.** This captures the reasoning and decisions from the conversation that led here, so the team picking this up doesn't have to reconstruct it.

## Why this exists

Two real bugs were found in how Vantra embeds MeshCentral for Remote Tools: a deep-link URL doesn't auto-connect the desktop/terminal/files session (needs a second manual click even after the customer already clicked "Connect to device" in Vantra), and the file browser silently reopens wherever it was last left rather than at root. Both were root-caused precisely (exact function, exact missing logic) by reading MeshCentral's real source on the VPS — but two attempts to patch the live server directly (once on the wrong file entirely, `default3.handlebars` when the server actually serves `default3-min.handlebars`; once on the right file with logic that still didn't visibly fire) didn't produce the expected result, and the second failure showed **zero JavaScript errors** in the browser console, meaning the fix's condition is silently evaluating false rather than crashing — almost certainly a data-loading timing gap between "URL loads the page" and "user clicks a device in Mesh's own list" (the latter guarantees the mesh-group/capability data has already arrived; the former doesn't).

Chasing that further via blind SSH patches to a minified production file, verified only by asking the user to paste console screenshots, is not a good iteration loop. Two production files being manually patched with no real debugger, no hot reload, and no ability to add a `console.log` and just look, is the actual problem — not that the bug is unsolvable.

## The licensing finding that shapes everything here

Checked both projects' actual licenses directly, not from memory:

- **MeshCentral: Apache License 2.0.** Fully permissive — fork it, modify it, keep changes private, use it commercially, no restrictions, no obligation to publish anything back.
- **TacticalRMM: a custom, non-open-source license** (AmidaWare LLC, License v1.0). It explicitly prohibits using the software (or a derivative/modified version) "as part of any other commercial or for-profit service... including... a service allowing third parties to interact remotely through a computer network; as part of a SaaS service or product" without AmidaWare's prior written approval — and separately, any derivative work made available to anyone else must have its complete modified source published publicly, which defeats the point of forking it to keep customizations proprietary.

**Decision (confirmed with the user 2026-09-09)**: proceed with forking MeshCentral now — it carries zero licensing risk regardless of what happens with TRMM. TacticalRMM itself is **not** being forked or modified. Current TRMM usage continues unchanged while proper commercial licensing is pursued directly with AmidaWare as a separate business conversation — that conversation does not block or get blocked by the Mesh fork work.

## Why fork Mesh instead of trying to replace TRMM's whole feature set with it

Researched MeshCentral's actual plugin architecture before deciding this, not assumed:

- MeshCentral's plugin system genuinely reaches the agent itself (`pluginHandler.js`'s `addMeshCoreModules()` injects custom JS directly into the code running on every enrolled device) — real, production-grade extension infrastructure, not a toy API.
- But the actual plugin ecosystem (searched live on GitHub) has nothing resembling TacticalRMM's feature set. The most-starred plugins are narrow single-purpose tools (`MeshCentral-ScriptTask`, `MeshCentral-EventLog`, a Zabbix bridge plugin) — nobody has built checks/alerting/patch-management/policies on top of Mesh, including via the Zabbix bridge, which exists specifically because Mesh doesn't do that natively and the community reached for a *real dedicated monitoring platform* instead of building one inside Mesh.

**Conclusion**: rebuilding TRMM's monitoring/scripting/patch-management/policy feature set from zero inside Mesh's agent runtime is a multi-month-plus undertaking on its own — effectively building a competing RMM product. Forking both TRMM and Mesh (once TRMM's licensing is sorted) and keeping them paired the way they already work today gets to full ownership of the stack at a fraction of that cost, since neither one needs its feature set rebuilt from scratch.

## What's actually been sized up

| | MeshCentral | TacticalRMM |
|---|---|---|
| License | Apache 2.0 (clean) | Custom, restrictive (needs AmidaWare approval) |
| Primary language | JS (Node.js server + client) | Python/Django (backend), Vue (`tacticalrmm-web`), Go (`rmmagent`) |
| Approx. size | ~1.66 MB repo | Backend alone: ~63,000 lines of Python across apps for accounts/agents/alerts/automation/autotasks/checks/clients/core/scripts/services/software/winupdate |
| Repo health | 7,194 stars, 979 forks, active (pushed within days) | 4,457 stars (backend), active (pushed within days) |
| Split across repos? | No — one repo | Yes — `tacticalrmm` (backend), `rmmagent` (Go agent, separate repo), `tacticalrmm-web` (Vue frontend, separate repo) |

Forking TRMM later, if/when licensing allows, means forking all three of those repos together — they're not one monorepo.

## What's done

- Forked `Ylianst/MeshCentral` → `softdeployautomation-sketch/MeshCentral`, set to **private**.
- Pinned to the `1.2.4` tag — the exact version currently running in production (`vmi3548623`'s `meshcentral.service`) — confirmed via `npm view`/the live server logs, so the fork starts from a known-identical baseline, not an untested `master`.

## What's next (not started yet)

1. **Stand up a fully isolated sandbox instance** of the forked Mesh code — its own domain/subdomain, its own database, zero connection to the production TRMM instance, zero connection to any real customer or their devices (including Wilk's — his device must never be part of this testing).
2. **Enroll exactly one throwaway test device** into the sandbox using MeshCentral's own native standalone agent installer (not the TRMM-merged exe) — this is a real, separate enrollment path Mesh already supports on its own, with no TRMM involved at all.
3. **Debug the two known bugs properly this time** — add real `console.log` statements at the exact points identified (the `args.gotonode` branch in `gotoStartViewPage()`, and the `case 3` block in `onFilesStateChange()`), reload, read the actual console output, and only then write the real fix — instead of guessing blind against a file nobody can watch execute.
4. **Once both fixes are proven working in the sandbox**, decide the cutover plan for production. Important constraint already confirmed: TacticalRMM's Mesh integration is a **single global setting** (`CoreSettings.mesh_token`/`mesh_username`/`mesh_site`, one row for the whole TRMM instance) — there's no native way to move devices to a new Mesh server one at a time. Whenever this happens for real, it's a single coordinated cutover affecting every enrolled device at once (repoint `CoreSettings`, then push a re-enrollment step to every existing agent), not a gradual per-device migration. Plan it as a deliberate maintenance operation with the old Mesh instance kept running as a fallback until the new one's proven for everyone — not attempted opportunistically on a real customer's device first.

## Explicitly not doing yet

- Not touching TacticalRMM's code or forking its repos — pending the licensing conversation.
- Not migrating any real device (including Wilk's) to anything new — that only happens after step 4 above, deliberately, for every device at once.
- Not attempting to rebuild TRMM's monitoring/scripting/patch-management feature set inside Mesh — see the "why fork Mesh instead of replacing TRMM" reasoning above.

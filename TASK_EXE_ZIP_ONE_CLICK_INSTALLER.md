# Task — one-click ZIP installer for the Vantra desktop EXE (and other apps)

**Status: queued, lowest priority — pick up after every other current task is done.** Owner's ask: reuse the existing device-agent ZIP installer pattern (single ZIP, one click, UAC prompt, done) for the Vantra desktop app EXE too, embedding the latest CI build automatically, then do the same for SpaceWorker and ChannelryApp.

## Read this first — the actual zip-building logic is NOT in this repo

Investigated directly before writing this spec, not assumed. The existing "Add Device → ZIP" flow that already gives this exact one-click experience for the TRMM agent works like this:

- `app/api/devices/deployments/route.ts` (`installMethod === "zip"` branch, ~lines 285-357) is the trigger.
- `lib/zip-generator.ts`'s `callZipGenerator()` is a thin HTTP client — it POSTs `{exeUrl, apiUrl, clientId, siteId, agentType, authToken, launcherMode: true, flags: {...}}` to an **external Fastify microservice** (`MSI_GENERATOR_URL`/`MSI_GENERATOR_SECRET` in `lib/env.ts`), described in code comments as built by "the cybersecurity engineer" as a separate service.
- **That external service does the actual work**: fetches the real TRMM agent installer from a live TRMM URL, encrypts/embeds it into `Launcher.exe` + `Update.lnk`, zips it, and returns a masked download URL. None of the zip/encryption/UAC-elevation logic exists anywhere in the Vantra Next.js repo — this repo only ever sends it a pointer to what to embed.

**This means the Vantra-side half of this task and the external-service half are two separate pieces of work, in two separate codebases.** Cline can build and verify the Vantra-side piece from here; the external service needs its own corresponding change from whoever owns/maintains it — that's a coordination point for the owner, not something achievable purely inside this repo. Flag this clearly rather than trying to reimplement zip-building inside Vantra from scratch.

## What "embed the latest EXE build" should actually point at

Not a raw GitHub Actions artifact — those expire and require an authenticated API call to fetch, which is the wrong shape for a build pipeline. Use the **already-live, stable download URL** instead: `https://dl.instaweb.top/vantra/vantra-desktop-setup.exe` (set up earlier this session, same masked-download host already serving SpaceWorker's installer, currently updated by hand after each verified CI build). This is the same idea as today's `exeUrl` pointing at a live TRMM deploy URL — a stable pointer the external service fetches from, not a file this repo needs to hold or proxy itself.

## Scope for the Vantra-side piece (buildable now)

1. A trigger surface (likely alongside the self-service license/download UI in Settings, or its own "Get the desktop app" flow) that calls the external generator's `/build` endpoint the same way `callZipGenerator()` already does, but pointing at the stable Vantra EXE download URL instead of a TRMM deploy URL — needs the external service to actually accept an arbitrary payload URL for this (see below).
2. Reuse the existing renaming/labeling pattern already built (`updateLinkName`/`innerFolder`/`zipName`, sanitized via `safeArtifactName()`) rather than inventing new fields.
3. **Keep the current CI-artifact-to-stable-URL publish step manual for now** (download, independently verify per `EXE_BUILD_LESSONS_LEARNED.md`, upload) — don't auto-publish an unverified CI artifact straight to the public download URL as part of this task; that removes the human verification step this session has repeatedly shown is load-bearing (real bugs have been caught at exactly that step, not by CI alone).

## What needs coordinating with the external service (not Cline's to build alone)

The external generator's `/build` endpoint today is shaped around "embed a TRMM agent installer" specifically (`exeUrl` + `apiUrl` + `clientId`/`siteId`/`authToken`/`agentType` — TRMM-specific fields). Embedding an arbitrary desktop app EXE instead needs either a new endpoint or a new mode on that service accepting a generic payload URL with no TRMM-specific fields required. **This can't be scoped further from inside the Vantra repo — its source isn't here.** Whoever maintains that service needs to be looped in before this is buildable end-to-end.

## Also apply to SpaceWorker and ChannelryApp (owner's stated intent — same shape, later)

Once the Vantra piece and the external-service coordination are actually proven working end-to-end, repeat the same pattern for SpaceWorker's EXE and ChannelryApp's own distributable — don't start these in parallel before Vantra is proven, since the external-service dependency is the same unknown for all three and is better resolved once, not three times.

## Verification required before calling this done

1. Confirm with the external service's owner what a generic (non-TRMM) embed actually requires before writing any Vantra-side code against assumed field names.
2. Real test: generate a ZIP through the new flow, confirm the one-click launch actually installs/launches the Vantra desktop EXE (not just that a ZIP downloads) — same bar as every other EXE deliverable this session, a real install/launch test, not just a successful HTTP response.
3. Confirm the embedded payload is always the CURRENTLY-published stable installer, not a stale cached one, if the external service caches anything.

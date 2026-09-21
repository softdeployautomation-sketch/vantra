# Task 80 — Scope the `spaceworker.top` migration (SCOPING ONLY — do not implement yet)

**This is a scoping task, not a build task.** Follow the same discipline `BATCH_3`/Task 76 used: diagnosis and agreement before treatment. Read `TASK_MANAGEMENT_PLAYBOOK.md` first (verification + multi-agent coordination discipline — this touches both Vantra and SpaceWorker, and DNS/cert infra shared with the domain-separation work in Tasks 59-79). **Nothing in this task gets implemented until the open questions in Scope §2 are answered by the owner** — this file's job is to lay out the current state precisely and turn a one-paragraph ask into a concrete, confirmable plan.

## Owner's ask (verbatim context, 2026-09-21)

A new domain, `spaceworker.top`, has been purchased via NameSilo (currently on DNSOwl nameservers, not yet pointed anywhere — see the owner's screenshot in this task's origin conversation). Intent, in the owner's own words:

> "i am buying a new domain from namesilo, for spaceworker and vantra web hosting so we switch the public download host to instaweb and use broks beauty as a backup for public 2. that's make it like 3 different agents... so vantra becomes vantra.spaceworker.top... does the spaceworker exe delivered to client affected, i can revoke license and handover the new exe when we are done."

Reading this precisely (don't paraphrase past the owner's own words without flagging the ambiguity — see §2):
- `spaceworker.top` becomes the **web-hosting** domain for BOTH products (Vantra's dashboard AND SpaceWorker's own dashboard) — explicitly: `vantra.spaceworker.top`.
- Once the web-hosting role moves off `instaweb.top`, the owner wants to **repurpose `instaweb.top` as the public agent/download domain**, demoting `broks.beauty` to a **backup/secondary public** role ("public 2").
- This produces **three agent-domain identities** total (was two: public `agent.broks.beauty` + private `api.instaweb.top`).
- Explicitly asked: does this affect the SpaceWorker EXE already in customers' hands? (Yes — see §3.) Owner's own stated plan: revoke old licenses, hand over a freshly-built EXE once the cutover is live.

## Scope §1 — Current state inventory (verified live, 2026-09-21, don't re-derive this)

**Web-hosting domains** (the dashboard each product's users log into):
- Vantra: `vantra.instaweb.top` — nginx `vantra.conf`, `server_name vantra.instaweb.top`.
- SpaceWorker: `spaceworker.instaweb.top` — nginx `spaceworker.instaweb.top` vhost file, same pattern.
- **Both are hardcoded into their respective EXE's local runtime**: `HOSTED_APP_URL` — Vantra: `components/exe-gate.tsx:31`; SpaceWorker: `lib/exe-runtime.ts:37`. This is baked in at BUILD time, shipped inside the packaged installer. See §3 — this is the crux of the EXE-impact question.

**Agent (device check-in) domains** — a SEPARATE concern from web hosting, built in Tasks 59-66:
- Private: `api.instaweb.top` (`TRMM_PRIVATE_API_BASE_URL`).
- Public: `agent.broks.beauty` (`TRMM_PUBLIC_API_BASE_URL`), Task 66 infra (nginx mirrors `rmm.conf`, cert issued via certbot webroot — DNS-01/wildcard is BLOCKED, see Task 79, unrelated token/zone problem, still unresolved as of this task).
- Resolution logic: `lib/agent-domain-tier.ts`'s `isPrivateTier`/`normalizeAgentDomainTier`, consumed by `lib/agent-domains.ts`'s `resolveAgentApiBaseUrl`.

**Installer DOWNLOAD-LINK domains** — Task 74, a THIRD, independent concern from the above two (confirmed live this session: conflating this with the agent-domain split was the actual root cause of a real bug, Task 74's whole point was untangling it):
- Private-tier: `dl.instaweb.top` (generator's own `REDIRECT_BASE_URL`/`PUBLIC_URL` default).
- Public-tier: `dl.broks.beauty` (Task 74's `PUBLIC_DOWNLOAD_BASE_URL`, allowlisted in the generator's `resolveDownloadBase()`, `vantra-installer/generator/src/routes.ts`).
- Stable customer-facing EXE download paths (separate from per-job `/d/<uuid>` links): `dl.instaweb.top/vantra/...`, `dl.instaweb.top/spaceworker/...` — nginx `alias`'d straight to `/opt/vantra/downloads/` and `/opt/spaceworker/downloads/`.
- **Task 76's live finding, still relevant**: `dl.broks.beauty`'s cert is brand-new (issued 2026-09-21) with zero reputation history, and Defender/SmartScreen verdicts track serving-host reputation, not file bytes. This is a real factor in the owner's "use broks.beauty as backup" instinct — a fresh `spaceworker.top`-based domain would have the EXACT SAME zero-reputation problem on day one. Don't let that surprise whoever implements this.

**The generator microservice** (`vantra-installer/generator`, `vantra-msi-generator.service`) is reached via `vantra.instaweb.top/msi-generator` (an nginx path prefix on the VANTRA web-hosting vhost, not its own subdomain) — if `vantra.instaweb.top` moves, this path needs to either move with it or get its own stable location; don't let it silently break.

**DNS/cert provisioning precedent** (Task 66 — this is what makes the owner's "fast way to turn things up" possible, reuse it, don't reinvent): Cloudflare DNS-only (grey-cloud) A records → `164.68.105.96`, TLS via `certbot certonly --webroot` (NOT `--dns-cloudflare`, because the existing Cloudflare API token in `cloudflare.ini` is scoped to the `instaweb.top` zone only and does NOT hold `broks.beauty` — confirmed live, and Task 79's wildcard attempt hit the identical wall). **A brand-new `spaceworker.top` zone will hit this SAME token-scope question** — resolve it as part of this task's §2, don't discover it live again.

## Scope §2 — Open questions (answer these before anything is built)

1. **Does `spaceworker.top`'s root serve SpaceWorker itself, with Vantra on a subdomain** (`spaceworker.top` = SpaceWorker's dashboard, `vantra.spaceworker.top` = Vantra's — matching the owner's own explicit `vantra.spaceworker.top` phrasing), **or does SpaceWorker also move to its own subdomain** (e.g. `app.spaceworker.top` or `extractor.spaceworker.top`) for symmetry with Vantra? The owner named Vantra's target explicitly but not SpaceWorker's — don't assume, ask.
2. **Precisely what happens to the three download/agent domains?** The owner's phrasing ("switch the public download host to instaweb," "broks.beauty as backup for public 2," "3 different agents") most plausibly reads as:
   - `agent.broks.beauty` demotes from primary public to a secondary/failover public agent domain.
   - `api.instaweb.top` — currently PRIVATE — becomes the PRIMARY PUBLIC agent domain instead? Or does a NEW `agent.spaceworker.top`-style subdomain become the new private domain, freeing `instaweb.top` entirely for this reshuffle? **This is the single most consequential ambiguity in this task — get it in writing from the owner before touching `lib/agent-domain-tier.ts`, `lib/installer-download-host.ts`, or any nginx config.** Getting it wrong doesn't just mislabel a badge, it reroutes real customer device traffic (same class of risk Task 74 was built to manage carefully).
   - Does "download host" here mean the per-job `/d/<uuid>` masked links (Task 74's actual scope), the stable `dl.*/vantra/`+`dl.*/spaceworker/` EXE download paths, or both? They're on the same hostnames today but are logically separate (masked per-job links vs. the one stable "get the installer" link) — the plan should say explicitly which it's changing.
   - Is there still a genuine PRIVATE tier after this reshuffle, and which hostname is it? Sc01t and Mblast (the two real private-tier orgs) must keep working through whatever ends up being "private" — this is real customer-adjacent infrastructure, not a test.
3. **Cloudflare zone/token access for `spaceworker.top`** — same question Task 79 hit and never resolved for `broks.beauty`: does the account this gets purchased/managed under have (or can it get) an API token with DNS write access to the new zone, enabling `--dns-cloudflare` wildcard issuance from day one (avoiding the webroot-only limitation `broks.beauty` is stuck with)? Resolving this NOW, while the domain is brand-new and no infra depends on it yet, is far cheaper than discovering it mid-migration.
4. **Transition window**: how long do `vantra.instaweb.top` / `spaceworker.instaweb.top` need to keep working after the new domain goes live? See §3 — this directly determines how disruptive the EXE-side cutover is for existing installs.
5. **"A fast way to turn things up right"** — confirm this means: reuse Task 66's exact proven sequence (Cloudflare DNS-only A records → certbot webroot → nginx vhost mirroring an existing one, server_name + cert paths only differing) rather than a different/novel provisioning method. If so, say so explicitly in the plan so whoever implements doesn't improvise a different approach.

## Scope §3 — EXE impact (the owner's own question, answered precisely)

**Yes, both products' shipped EXEs are affected**, and the mechanism is the same for both:

- `HOSTED_APP_URL` is a compile-time constant baked into the packaged local runtime at build time (`npm run exe:build:web` → `next build` with `BUILD_TARGET` set → `scripts/runtime-assemble.mjs` bundles the standalone output). It is NOT read from a server config the EXE checks at runtime — changing the live web-hosting domain does nothing to an already-installed EXE.
- **Every currently-installed EXE (both products) will keep calling its OLD hosted-app domain indefinitely** unless: (a) the old domain is kept alive and working for as long as any old install exists, or (b) every existing install is forced to update.
- The owner's own stated plan for SpaceWorker — **revoke the old license, hand over a freshly-built EXE** — is exactly the right mechanism, and this session already shipped the pieces it needs:
  - The live revocation check (`app/api/exe-license/eligibility` + `stillValidLive` in `status/route.ts`, both products) means a revoked old license genuinely stops working on the OLD EXE's next launch, not just in the admin's own record.
  - A fresh EXE build (`gh workflow run "Build EXE" ...`) baked with the NEW `HOSTED_APP_URL` gives the customer a working install pointed at the new domain.
  - The stable download link (`dl.<host>/spaceworker/...`) needs updating to the new build, same as done earlier this session — and confirm which HOST that stable link itself lives on post-migration (§2's second bullet).
- **Recommend**: keep the OLD web-hosting domains (`vantra.instaweb.top`, `spaceworker.instaweb.top`) alive and serving (not decommissioned) for a real transition window even after the new domain is live — cheap to leave running, and it means a revoke-then-reissue cutover can happen per-customer on the owner's own schedule rather than as a hard flag-day that breaks everyone still on an old EXE simultaneously. Confirm the desired window length with the owner (§2.4).
- Vantra's own EXE has the SAME exposure as SpaceWorker's, even though the owner's message focused on SpaceWorker — call this out explicitly when scoping with the owner, don't let Vantra's EXE silently break because the question was asked about SpaceWorker specifically.

## Out of scope (for this task specifically)

- No DNS records, no Cloudflare zone changes, no nginx config, no code changes. This task produces AN AGREED PLAN, appended to this file, that a SEPARATE implementation task (Task 81+) executes.
- Don't touch Task 79's wildcard-cert blocker as part of this — it's a separate, already-tracked, still-unresolved item; mention it if relevant to §2.3 but don't attempt to unblock it here.

## Verification expected

- This file, appended with: answers to every question in §2 (in the owner's own words where possible, or a clearly-marked assumption if the owner explicitly delegates a decision), and a concrete, ordered implementation plan (DNS records needed, cert issuance method, which nginx vhosts get created/edited, which env vars change on which service, the EXE rebuild-and-redeploy sequence for both products, and the transition-window decision from §3).
- The next task (implementation) should be able to work from this file's appended plan without needing to re-ask the owner anything already answered here.

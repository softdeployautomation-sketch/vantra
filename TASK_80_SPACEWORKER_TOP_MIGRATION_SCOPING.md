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

## Scope §2 answers (owner, 2026-09-21 session)

1. **§2.1 ANSWERED**: `spaceworker.top` (root) = SpaceWorker dashboard; `vantra.spaceworker.top` = Vantra app. No extra subdomain for SpaceWorker.
2. **§2.2 ANSWERED, CORRECTED (2026-09-21, third pass — supersedes the "primary/backup" framing below)** — the owner's own words: *"backup still remains private, the both public acts the same, any user can get either or both from admin, any device auto move to private from public and user can set it or leave it on set, but private remains where the device eventually stay safe from public reach. only can use powershell to add device."* Precisely, this is NOT a primary/backup pair of public domains — it's:
   - **Private → `spaceworker.top`** (unchanged from the earlier answer — this is what "backup... remains private" refers to: the safe-harbor role stays exactly the concept already built in Tasks 59-75, just on the new domain instead of `api.instaweb.top`). Same existing restrictions carry over unchanged: **no self-service installer at all** — a device only ever reaches private via the existing PowerShell move-script (Task 70's `private-move-panel.tsx`/move-script route), never a direct install flow. Same existing auto-move-from-public behavior (Task 64's 20-minute silent auto-move + its per-org toggle) also carries over unchanged.
   - **`broks.beauty` AND `instaweb.top` are BOTH public, treated as functionally equivalent** — not a primary/secondary pair. **"Any user can get either or both from admin"** — the admin controls, per user/org, which of the two public hostnames (one or both) that org is allowed to use for installer generation. This is a genuinely new, small piece of surface area: today `agentDomainTier` is a binary public/private value per org with ONE fixed public constant behind it; this needs the public side to become **selectable**, not just resolved to a single hardcoded host.
   - This is **still deferred to Task 82**, not part of Task 81 — the owner explicitly chose to land the web-hosting cutover first. Nothing in Task 81 touches `lib/agent-domain-tier.ts`, `lib/installer-download-host.ts`, TRMM agent URLs, or `dl.*` vhosts. This answer is captured now so Task 82 can start immediately once Task 81 is live, without re-asking.
3. **§2.3**: owner creates the Cloudflare zone + a zone-scoped DNS-edit API token (steps in the owner checklist below) — resolving the Task 79 token-scope wall for this zone from day one.
4. **§2.4 ASSUMED** (owner to confirm): old domains `vantra.instaweb.top` / `spaceworker.instaweb.top` stay live and serving indefinitely for now (no flag-day for old EXEs); decommission decision deferred.
5. **§2.5 CONFIRMED**: reuse the exact Task 66 proven sequence — Cloudflare DNS-only (grey-cloud) A records → `164.68.105.96`, `certbot certonly --webroot`, nginx vhosts mirroring existing ones (server_name + cert paths only differing). No novel provisioning.

## TASK SPLIT DECISION (this session)

- **Task 81 — Web-hosting cutover to spaceworker.top (Part 1, this plan)**: Cloudflare zone/DNS/records + certs + nginx vhosts + Vantra app env + generator path + SpaceWorker dashboard vhost. Server-side agent work + owner DNS steps only. No code changes to tier/download logic. No EXE rebuild REQUIRED to keep the web live (old domains keep working), but new EXE builds pick up the new `HOSTED_APP_URL` at the owner's pace.
- **Task 82 — Agent/download-domain reshuffle (Part 2, later)**: answers §2.2 in writing first (which hostname becomes primary public agent, whether `api.instaweb.top` is repurposed, whether a private tier survives and on which hostname, masked vs stable download links, `dl.*` on which host). Touches `lib/agent-domain-tier.ts`, `lib/installer-download-host.ts`, generator `resolveDownloadBase()` allowlist, TRMM domains, `dl.*` vhosts. DO NOT start until the owner answers §2.2 — real customer device traffic reroutes here.
- EXE rebuild + license revoke/reissue handover (both products): owner-driven, uses the already-shipped revocation check + `gh workflow run "Build EXE"` with the new `HOSTED_APP_URL`. Vantra's EXE has the SAME exposure as SpaceWorker's (§3) — don't forget it.
- Don't touch Task 79's wildcard-cert blocker as part of this — it's a separate, already-tracked, still-unresolved item; mention it if relevant to §2.3 but don't attempt to unblock it here.

## Verification expected

- This file, appended with: answers to every question in §2 (in the owner's own words where possible, or a clearly-marked assumption if the owner explicitly delegates a decision), and a concrete, ordered implementation plan (DNS records needed, cert issuance method, which nginx vhosts get created/edited, which env vars change on which service, the EXE rebuild-and-redeploy sequence for both products, and the transition-window decision from §3).
- The next task (implementation) should be able to work from this file's appended plan without needing to re-ask the owner anything already answered here.


## TASK 81 IMPLEMENTATION PLAN (Part 1 — approved to proceed)

### Phase A — Owner (manual, Cloudflare + NameSilo)
1. Cloudflare dash → Add a site → `spaceworker.top` → Free plan.
2. Cloudflare SSL/TLS mode: set **Full (strict)** (origin certs are Let's Encrypt).
3. Create an API token: My Profile → API Tokens → Create Token → scoped to zone `spaceworker.top`, permission `Zone / DNS / Edit`. Hand it over (it goes to `/etc/letsencrypt/cloudflare.ini` on the VPS so future `--dns-cloudflare` wildcard issuance works in THIS zone — avoids repeating the broks.beauty wall).
4. NameSilo → Domain Manager → `spaceworker.top` → NameServers: replace all DNSOwl entries (`ns1/ns2/ns3.dnsowl.com`) with the TWO Cloudflare nameservers Cloudflare assigns. Save. Wait for delegation (minutes–hours; `dig NS spaceworker.top +short` shows Cloudflare).

### Phase B — Agent (VPS, after delegation confirmed)
5. Cloudflare DNS records in the new zone (ALL **DNS-only / grey-cloud**, mirroring Task 66 precedent — proxied would break certbot webroot and change TLS termination):
   - `A spaceworker.top → 164.68.105.96` (root = SpaceWorker dashboard)
   - `A vantra.spaceworker.top → 164.68.105.96`
   - Phase-2 records (`agent.` / `dl.` / `api.`) are NOT added yet — Task 82 decides their names; adding unused surfaces early is rejected.
6. Certs (webroot, one SAN lineage `spaceworker-top`: `spaceworker.top` + `vantra.spaceworker.top`):
   `certbot certonly --webroot -w /var/www/certbot -d spaceworker.top -d vantra.spaceworker.top`
7. nginx vhosts (mirror existing, server_name + cert paths only):
   - `spaceworker.top.conf` mirrors `spaceworker.instaweb.top.conf` (SpaceWorker dashboard).
   - `vantra.spaceworker.top.conf` mirrors `vantra.conf` verbatim **including the `/msi-generator` location block** — the generator microservice is reached via a path prefix on the Vantra web vhost, not its own subdomain; without it the web app's generator calls break the moment anyone points at the new host.
   - `nginx -t`, reload; verify live TLS on both names, serving byte-identical to the old vhosts.
8. Vantra app env (VPS `vantra` service env + local `.env`): point the app's own public URL at `https://vantra.spaceworker.top` (whatever `NEXT_PUBLIC_APP_URL`/`APP_URL` it reads) — the app keeps RUNNING fine on the old host meanwhile, so this is a config add, not a flag-day. Keep generator env (`MSI_GENERATOR_URL`/`ZIP_GENERATOR_URL`) unless it hardcodes `vantra.instaweb.top/msi-generator` — if it does, point it at the NEW host (preferred) while `/msi-generator` stays live on BOTH vhosts during transition.
   - Code constants confirmed NOT in Part-1 scope: `components/exe-gate.tsx:31` `HOSTED_APP_URL` (EXE-baked, changes only in a new EXE build) and `lib/exe-license.ts` `dl.instaweb.top` stable EXE link (download-domain, Task 82).
9. Old domains stay live and untouched (§2.4 assumption). Regression check: old vhosts still serve after nginx reload.

### Phase C — Verification
10. `dig` both new names → 164.68.105.96; TLS valid on both; both dashboards load identically to old hosts (login smoke test); `/msi-generator` reachable on `vantra.spaceworker.top` (a `POST /build` E2E like Task 77's proves the chain); old `vantra.instaweb.top` unchanged.
11. Update TASK_80 with done markers; Task 82 now ready to start once Task 81 is live (§2.2 answered below).

## TASK 82 SCOPE — CORRECTED (2026-09-21, third pass — this replaces the earlier primary/backup version below the strikethrough note)

**This is not a primary/backup pair.** Corrected final design, from the owner's own words (quoted in §2.2 above):

- **Private → `spaceworker.top`** (e.g. `api.spaceworker.top`, mirroring `api.instaweb.top`'s naming). Role is UNCHANGED from what's already built in Tasks 59-75 — just a new hostname behind the same concept: no self-service installer at all (PowerShell move-script only, Task 70), receives devices via Task 64's existing 20-minute auto-move (still owner/org-togglable, unchanged), "where the device eventually stays safe from public reach" in the owner's own words.
- **Public → BOTH `broks.beauty` and `instaweb.top`, functionally equivalent.** Not primary/secondary, not automatic failover. **The admin controls, per user/org, which public hostname(s) that org is allowed to use** — "any user can get either or both from admin." This is genuinely new surface area (see below), not a resolution-order tweak.

### The real, concrete change this needs

Today `Organization.agentDomainTier` is a binary `"public" | "private"` value, and the public side always resolves to ONE hardcoded constant (`TRMM_PUBLIC_API_BASE_URL`). That no longer fits: a public-tier org now needs to be associated with a SET of allowed public hostnames (one or both), admin-assigned. Concretely:

1. **Data model**: `Organization` needs to know WHICH public host(s) it's allowed to use. Simplest shape that fits the existing conventions (reuse, don't invent a new pattern): a new field, e.g. `Organization.publicAgentHosts: String[]` (or two booleans `allowBroksBeauty`/`allowInstaweb` if the schema's existing style favors explicit named fields over arrays — check how `agentDomainTier` itself was added in Task 59's migration for the house convention). Defaults to whichever is the CURRENT single public host for every existing org (backward-compatible, no behavior change for anyone until an admin deliberately grants a second option).
2. **Admin UI**: extend Task 75's generalized grant/org-management flow (`grant-private-org-button.tsx`'s already-generalized tier picker, `components/admin/admin-users-client.tsx`) to also let the admin pick which public host(s) an org can use — this is additive to the SAME admin surface that already handles tier, not a new page.
3. **Installer generation**: when a public-tier org has BOTH hosts allowed, the Add Device flow needs a way to pick which one for THIS install — a simple selector next to the existing method picker (`components/add-device-modal.tsx`), defaulting to whichever the org has if only one is allowed (no new UI for the common single-host case).
4. **`lib/agent-domain-tier.ts`/`lib/agent-domains.ts`/`lib/installer-download-host.ts`**: `resolveAgentApiBaseUrl` and the installer-download-host resolver both currently take just the tier; they need to take the ORG's actual allowed-host selection for the public case, not a single hardcoded constant. Private-side logic (`isPrivateTier` etc.) is otherwise completely unchanged.
5. **New private hostname**: `api.spaceworker.top` — its own Cloudflare A record (grey-cloud) + cert (reuse the `spaceworker.top` zone/token Task 81 already sets up — no Task 79-style token-scope blocker here) + nginx vhost mirroring `rmm.conf` (same pattern Task 66 used for `agent.broks.beauty`). `TRMM_PRIVATE_API_BASE_URL` changes from `api.instaweb.top` to this.
6. **`instaweb.top` gets its own agent subdomain for the public role** (e.g. `agent.instaweb.top`, mirroring `agent.broks.beauty`'s naming — NOT `api.instaweb.top`, since that hostname's role is moving to private's replacement and shouldn't be reused for public in the same breath) — its own A record/cert/vhost, same Task 66 pattern.
7. **Real existing private-tier devices must be migrated, not just reconfigured server-side** — Sc01t and Mblast (`myrate619@gmail.com`, `mymood619@gmail.com`) have real, already-installed agents currently checking in via `api.instaweb.top`. Changing `TRMM_PRIVATE_API_BASE_URL` alone does NOT move an already-running agent — reuse Task 62's `buildAgentDomainMoveScript`/agent-side reconfigure-and-restart mechanism (already built, already proven) to point those specific existing agents at the new private host. One device at a time, like Task 67's original (now-moot) scope.
8. **Download-link hosts** (Task 74's separate concern) — decide explicitly whether `dl.*` mirrors this same "admin picks which host(s)" model, or stays simpler. Don't assume without confirming; the owner's message was specifically about agent domains.
9. **Full verification**: an org granted BOTH public hosts can generate installers on either, correctly routed; an org granted only one never sees a choice and can't be routed to the other; private-tier installer generation (still PowerShell-only) routes to `api.spaceworker.top`; Sc01t/Mblast's real devices confirmed still checking in post-migration (TRMM admin + live-online check, Task 62's verification bar); Task 64's auto-move-to-private still fires correctly regardless of which public host a device originated on.

<!-- Superseded below — kept for history, do not implement the primary/backup framing. -->

## TASK 81 — EXECUTED + VERIFIED LIVE (2026-09-21, this session)

- Zone `spaceworker.top` active on Cloudflare (`iris`/`leland.ns.cloudflare.com`, confirmed via 1.1.1.1). Owner-created DNS-edit token installed at `/etc/letsencrypt/cloudflare-spaceworker.ini` (0600) — Task 82's DNS-01 needs in this zone are unblocked from day one.
- DNS: `A spaceworker.top` + `A vantra.spaceworker.top` → `164.68.105.96`, both grey-cloud, verified via 1.1.1.1.
- Cert: lineage `spaceworker-top` (SANs `spaceworker.top` + `vantra.spaceworker.top`), issued via certbot webroot (`/var/www/certbot`); `certbot renew --cert-name spaceworker-top --dry-run` SUCCESS.
- nginx: `vantra.spaceworker.top.conf` mirrors `vantra.conf` verbatim incl. the `/msi-generator` block; `spaceworker.top.conf` mirrors the SpaceWorker vhost verbatim (maintenance page, `/browser/`, loopback-only `/api/internal/`, 200s IMAP-poll block). HTTP 80 = ACME + 301. `nginx -t` clean, reloaded.
- Live verification: both 443s 200 with valid certs; HTTP→HTTPS 301; HTML **byte-identical** to old hosts (sha256 match, both apps); `/msi-generator/` parity proven (GET / 404 on both hosts, POST /build 401 on both, /health 200); regression green — `vantra.instaweb.top`, `spaceworker.instaweb.top`, `dl.broks.beauty`, `agent.broks.beauty` all still 200.
- Env cutover (rollback: `/opt/vantra/.env.bak-20260921-spaceworker`): `APP_BASE_URL` + `MSI_GENERATOR_URL` → `https://vantra.spaceworker.top…`; `vantra.service` restarted, active, 200.
- Old domains intentionally left serving (§2.4 transition window — old EXEs keep working).
- NOT done here (by design): `components/exe-gate.tsx:31` HOSTED_APP_URL (EXE-baked), `lib/exe-license.ts` dl.instaweb.top stable link, all agent/download vhosts — Task 82's scope.
## TASK 82 (PRIVATE-HOST SLICE) — EXECUTED: WilkSF9 MIGRATED TO api.spaceworker.top (2026-09-21)

Scope executed per owner: forget Mblast; only the Sc01t private-org device (WilkSF9) needed migrating — and it was ALREADY in the Sc01t org, so no site reassignment, only the URL reconfigure.

- DNS: `A api.spaceworker.top` → `164.68.105.96` grey-cloud, created via the staged Cloudflare zone token (zone `43758174481e463c1274265f131d157a`).
- Cert: lineage `api-spaceworker-top` via webroot; renew dry-run to be checked on next renewal cycle pass (same webroot as Task 81 lineages).
- nginx: `api-spaceworker.conf` = rmm.conf's 443 block verbatim except server_name + cert paths + `reuseport` dropped (only one 443 listener may hold it). `reuseport` duplicate was the only nginx -t failure; no outage occurred. The 3 remaining `instaweb` strings in the file are the CORS `Access-Control-Allow-Origin: https://rmm.instaweb.top` headers, intentionally verbatim.
- **TRMM gotcha found**: Django `ALLOWED_HOSTS` (in `/rmm/api/tacticalrmm/tacticalrmm/local_settings.py`) did not know the new host → every request to it 400'd. Fixed by appending `api.spaceworker.top` (order preserved so `TRMM_ROOT_DOMAIN` from ALLOWED_HOSTS[0] still = instaweb.top) + `systemctl restart rmm.service`. **Task 82 public-host work must do the same for any new TRMM agent hostname.**
- Vantra env: `TRMM_PRIVATE_API_BASE_URL` → `https://api.spaceworker.top` (rollback: `/opt/vantra/.env.bak-20260921-apisw`), `vantra.service` restarted. `TRMM_API_BASE_URL` (public) left on `api.instaweb.top` until the public reshuffle.
- Move executed via TRMM raw-cmd (same mechanism as `buildAgentDomainMoveScript`): registry rewrite verified by read-back (`BaseURL=https://api.spaceworker.top`), then `Restart-Service tacticalrmm`. Note: the restart cmd reliably returns HTTP 400 "Unable to contact the agent" — that is the RPC result being lost mid-restart; the restart itself lands (verified, see next line).
- **Verification (conclusive)**: temporary unfiltered access log on the new vhost showed WilkSF9's agent live traffic — `/checkinterval`, `/checkrunner`, `/config`, `/syncmesh`, `/checkin`, `/software`, `/winupdates` all 200 through `api.spaceworker.top`. Filtered log restored after. Agent status online, fresh last_seen, live cmd PING OK post-migration. Agent VM was flaky during ops (raw-cmd 400s intermittently, incl. a broken-quote Start-Process line needing a separate restart cmd) — retries + direct read-back closed it out.
- The move-script API route (`app/api/devices/move-script/route.ts`) was NOT used: it asserts a public move source; this device was already private. Nothing in the route changed.
- NOT done (rest of Task 82): public per-org allowed-hosts model, `agent.instaweb.top`, download-link hosts decision, Organization field shape. Old `api.instaweb.top` left serving (only private agent is now off it, but keep it until public reshuffle decides its fate).

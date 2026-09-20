# Plan — separate the "gets scanned/flagged" traffic from the "customer trusts this" domain

**Status: scoped 2026-09-21, NOT YET IMPLEMENTED.** Owner's concern: RMM installers and agent binaries are a well-known industry target for AV/EDR/Safe-Browsing reputation flags — even fully legitimate ones, purely because the same class of software is also abused by attackers for C2. If that flagging ever hits the domain the main app/website lives on, the whole product goes down with it, not just downloads. Pre-launch (no real customers yet, no installed agents in the field) is the cheapest possible moment to fix this — every day after the first real customer installs an agent raises the cost of changing any of this.

## Current topology (verified live on the VPS, not assumed)

Everything today is under one registered domain, `instaweb.top`, split by subdomain:

| Subdomain | Serves | Backend |
|---|---|---|
| `vantra.instaweb.top` | Vantra web app (dashboard, billing, admin) | Next.js on :3300 |
| `spaceworker.instaweb.top` | SpaceWorker web app + marketing site | Next.js on :3500 |
| `dl.instaweb.top` | Installer/EXE artifact downloads for BOTH apps (`/d/`, `/e/`, `/spaceworker/`, `/vantra/`) — already origin-masked, streams from a separate generator service | proxies to :4000 (generator) + static file dirs |
| `api.instaweb.top` | TacticalRMM's own agent check-in API — **the URL baked into every generated agent installer**, what every installed device phones home to forever after | TRMM's own stack |
| `mesh.instaweb.top` | MeshCentral (remote device control) | MeshCentral |
| `rmm.instaweb.top` | TacticalRMM's own admin frontend | TRMM frontend |

All six share ONE wildcard Let's Encrypt cert (`/etc/letsencrypt/live/instaweb.top/`) and, more importantly, **one registered domain** — a registrar-level suspension, a WHOIS-based blocklist, or any reputation system that keys off the apex domain rather than the exact hostname would take all six down together, even though they're technically separate subdomains today.

Email: both apps currently send from `noreply@instaweb.top` (shared sending domain/reputation).

## The risk model — refined from the original framing

The owner's framing was "downloads vs. everything else." Investigating the actual code turned up a more precise, three-category split, because **the download page is not the only thing that touches a customer's device** — some of this domain gets called continuously by software already running on customer machines, which is a materially higher-consequence exposure than a one-time download page:

1. **Human browsing traffic** (marketing site, dashboard, billing, admin) — normal web traffic, lowest reputation risk, and the one customers bookmark/get emailed/see in their browser history. This is the "must never go down" trust anchor.
2. **One-time binary downloads** (installer EXE/MSI/ZIP files) — what AV vendors and Safe Browsing actually scan and flag. Currently `dl.instaweb.top` (already a separate subdomain, good) plus, for SpaceWorker specifically, a GitHub Release (`github.com/.../releases/...` — already a genuinely separate domain, no change needed there).
3. **Ongoing "software phones home" traffic** — this is the one the original framing missed, and it's arguably the highest-risk category: corporate EDR/antivirus heuristics specifically watch for installed software making repeated outbound calls to an unfamiliar domain (classic C2 pattern-matching), and this happens every day, on every device, indefinitely — not once at install time. Confirmed live in the code:
   - **TRMM agents** already call `api.instaweb.top` (`TRMM_API_BASE_URL`) — already isolated from `vantra.instaweb.top`. Good, no change needed here structurally (though see the apex-domain caveat above).
   - **SpaceWorker's EXE** calls `HOSTED_APP_URL` — hardcoded in `lib/exe-runtime.ts` as `https://spaceworker.instaweb.top` — for EVERY hosted operation: trial-ping, license status, auto-bind, password sign-in, buy-now checkout/payment-status. This is the SAME domain as the marketing site and dashboard. If this domain ever gets flagged, the EXE breaks for every customer AND the website goes down with it, since it's one and the same.
   - **Vantra's EXE** is architecturally a thin wrapper — `components/exe-gate.tsx` redirects straight into `https://vantra.instaweb.top/workspace`, and all "real" access happens through normal web-session requests to that same domain. Same exposure as SpaceWorker's case.

**The corrected takeaway**: moving just the download/generator page (what the owner originally proposed) helps, but doesn't close the biggest gap — both EXEs' *ongoing* operation still talks directly to the same domain the marketing site and dashboard live on.

## Recommended architecture

Register **one new apex domain** (a genuinely separate registration, ideally a different registrar/DNS provider too, so even a WHOIS-correlation or registrar-level action can't connect it back to the customer-facing domain) dedicated to everything in risk categories 2 and 3 above. Keep `instaweb.top` exactly as it is today for category 1 (the human-facing sites) — **no change to `vantra.instaweb.top` / `spaceworker.instaweb.top` at all**, so nothing bookmarked, emailed, or already indexed breaks.

Concretely, on the new domain (call it `NEWDOMAIN` below — pick the actual name later, this plan doesn't depend on it):
- `dl.NEWDOMAIN` — replaces `dl.instaweb.top` (downloads).
- `agent.NEWDOMAIN` (or similar) — replaces `api.instaweb.top` (TRMM agent check-in). Highest-consequence one to get right BEFORE any real agent is installed, since moving it later means regenerating and redistributing installers to every already-installed device.
- `sw-api.NEWDOMAIN` / `vantra-exe.NEWDOMAIN` (or one shared `exe-api.NEWDOMAIN` serving both, path- or subdomain-scoped per app) — new home for the EXE-facing API surface both apps' desktop clients call for their own ongoing operation (SpaceWorker's `/api/exe-license/*`, `/api/exe/*`, `/api/billing/*`; Vantra's equivalent). This is genuinely new work — today those routes are served from the SAME Next.js deployment as the website, just reached via a different hostname pointed at the same backend (exactly how `dl.instaweb.top` already proxies to a different origin port without any app code change — same trick, no new service needed, just nginx routing the new hostname to the existing app's existing port).
- `mesh.NEWDOMAIN` — optional; MeshCentral is also "software calling home continuously" (remote-control websocket from every device with an active session), worth including for the same reason as the agent check-in domain, though lower urgency than the RMM agent check-in itself.

This does **not** require restructuring either app into separate services — it's an nginx + DNS + a handful of URL-constant changes, since the routes already exist and already run on the same backend process; only WHICH hostname reaches them changes.

## Why not the owner's Option B (move the site, keep instaweb.top for installers/agents)

Considered and rejected as the default recommendation, though it's a valid alternative if there's a reason to believe `instaweb.top` already carries some reputation baggage worth "spending" on the riskier traffic instead of the customer-facing brand (the owner would know this better than an investigation of the code can show):

- Moving the MAIN sites touches strictly more surface: every existing `APP_BASE_URL`/`HOSTED_APP_URL` reference across both apps, every email template's links, any external references (GitHub Release notes, this session's own worked examples, any documentation), and it changes the URL customers would already be bookmarking/receiving in emails once real customers exist. Recommended-plan's approach only touches the smaller, more isolated "download + EXE-API + agent" surface, leaving the larger "everything a human clicks on" surface untouched.
- There's no evidence found during this investigation that `instaweb.top` itself currently carries any reputation problem — it's a precaution, not a response to an active issue. If that's wrong (the owner has specific reason to think otherwise), Option B becomes the better call and this plan's touchpoint list still applies, just with the roles of "old domain" and "new domain" swapped.

## Every touchpoint this actually changes (recommended-plan version)

### Infrastructure (do this first — has real calendar-time lead time)
- [ ] Register the new apex domain (ideally different registrar/DNS provider than `instaweb.top`'s).
- [ ] Point its DNS at the same VPS (164.68.105.96) — new A/AAAA records for each new subdomain.
- [ ] Issue a new Let's Encrypt cert (or wildcard) for the new domain via certbot — independent of the existing `instaweb.top` wildcard cert.
- [ ] New nginx server blocks: `dl.NEWDOMAIN` (near-identical copy of today's `dl.instaweb.top.conf`, same backend proxies), `agent.NEWDOMAIN` pointed at TRMM's existing API backend, `exe-api.NEWDOMAIN` (or two, per app) pointed at each app's existing Next.js port with a path-scoped `location` block covering only the EXE-facing API routes (or the whole app if simplest — see the SpaceWorker code-change note below on whether full separation or just the EXE routes is worth the complexity).
- [ ] **Email sending domain**: decide whether transactional email also moves to `noreply@NEWDOMAIN` or a third dedicated sending domain. If it moves, this needs its own SPF/DKIM/DMARC records set up on the new domain and — important, easy to underestimate — a gradual sending-volume warm-up period (days to weeks) before a new sending domain's deliverability matches an established one. Start this in parallel with everything else, not after; it's the one item here with the longest lead time that isn't attacker/reputation-driven.
- [ ] Simplify `MSI_GENERATOR_URL`: currently routes Vantra's own server-to-server call to its generator through the PUBLIC `vantra.instaweb.top/msi-generator` path (confirmed live in `vantra.conf`) — since both processes run on the same VPS, this can just become `http://127.0.0.1:4000` directly, no public hostname involved at all. Worth doing regardless of the domain-separation decision; it's a free simplification found during this investigation.

### SpaceWorker code changes
- [ ] `lib/exe-runtime.ts`'s `HOSTED_APP_URL` constant — currently one hardcoded string used by every EXE-local route for every hosted call. Decide: does it become `https://exe-api.NEWDOMAIN` for ALL of it (simplest — the EXE never talks to `spaceworker.instaweb.top` at all anymore), or does the marketing/store parts of the hosted API (e.g., `GET /api/billing/checkout` used by both the web store AND the EXE's Buy tab) need to stay reachable from both domains? Recommend: point `HOSTED_APP_URL` entirely at the new domain — the EXE never needs to reach the marketing site itself, only its API routes, and those can be served from either hostname since it's the same backend.
- [ ] `components/store.tsx`'s "Try for free" download link and the admin-issued `downloadUrl` in `lib/products.ts` — already GitHub-hosted, no change needed, but worth confirming this stays the primary distribution channel (a genuinely separate domain from both `instaweb.top` and any new domain — free diversification already in place).
- [ ] Every email template that includes a link (`exeLicenseIssuedEmailHtml`, `exeLicenseWelcomeEmailHtml`, `exeTransferCodeEmailHtml`, `exeTransferCompletedEmailHtml`, the claim-link flow) — these use `env.appBaseUrl`, which should almost certainly STAY `spaceworker.instaweb.top` (a human clicks these in their inbox — this is category-1 human-facing traffic, not EXE-to-server traffic), so likely no change, but audit each one to confirm none of them accidentally need to point at the new domain instead.
- [ ] `HOSTED_APP_URL` is a hardcoded string constant, not read from an env var — deliberately, because `scripts/runtime-assemble.mjs` strips `APP_BASE_URL` (along with `DATABASE_URL` and other server secrets) out of the EXE's bundled local `.env.local`, so it can't be read at runtime inside the packaged EXE at all. Changing it means a source edit + rebuild, not a config change. (Note: `.github/workflows/build-exe.yml`'s `APP_BASE_URL` secret is unrelated to this — it's only used by `lib/browser-session-serialize.ts` for the private-browser-session proxy feature, a completely different concern. Don't confuse the two when scoping the actual change.)
- [ ] A fresh EXE build + redistribution (GitHub Release + any already-installed test machines) once `HOSTED_APP_URL` changes — cheap right now, pre-launch; budget real coordination for this once real customers exist.

### Vantra code changes
- [ ] `.env`'s `APP_BASE_URL` — likely STAYS `vantra.instaweb.top` (human-facing, used for email links, the desktop-mode gate's redirect targets, etc.).
- [ ] `.env`'s `TRMM_API_BASE_URL` — becomes `https://agent.NEWDOMAIN`. Highest-priority, highest-consequence change; do this before any real agent gets installed, never after.
- [ ] `.env`'s `MESH_WSS_URL` — becomes `wss://mesh.NEWDOMAIN` if MeshCentral is included in this move (recommended, same "continuously calls home" risk category).
- [ ] `.env`'s `MSI_GENERATOR_URL` — becomes `http://127.0.0.1:4000` (see the infrastructure section — this one doesn't even need the new domain, just needs to stop being public at all).
- [ ] `components/exe-gate.tsx`'s `HOSTED_APP_URL` constant (`https://vantra.instaweb.top`) — unlike SpaceWorker, Vantra's EXE is a thin wrapper that redirects INTO the full dashboard, so this one likely has to STAY pointed at `vantra.instaweb.top` (the human-facing site) rather than moving, since that's genuinely where the dashboard lives for this architecture. Flag this asymmetry explicitly when scoping the actual work — Vantra's EXE may end up with less separation achievable here than SpaceWorker's, given its fundamentally different (browser-wrapper vs. real-offline-app) design. Worth a dedicated look rather than assuming full parity with SpaceWorker's approach.
- [ ] Every place `dl.instaweb.top`/`api.instaweb.top`/`mesh.instaweb.top` appear as literal strings — grep found these files referencing `instaweb.top` at all: `.env.example`, `app/api/health/route.ts`, `app/activate-complete/page.tsx`, `components/workspace-shell.tsx`, `components/exe-gate.tsx`, `components/admin/admin-exe-artifacts-client.tsx`, `components/admin/admin-platform-detail-client.tsx`, `components/admin/ops-console.tsx`, `lib/services-control.ts`, `lib/exe-license.ts`, `lib/exe-runtime.ts`, `lib/system-status.ts`, `lib/local-db/sync.ts`. Audit each one individually — some are almost certainly just health-check/status-display text (human-facing, no change needed), others are real functional URLs (need updating). Don't bulk-replace; check each.

### Testing (before calling this done)
- [ ] Full agent installer generation + install + check-in cycle against the NEW `agent.NEWDOMAIN`, on a disposable test device, before any real customer installer is ever generated pointing at it.
- [ ] SpaceWorker EXE full trial→buy→activate cycle (reuse `FINAL_ACCEPTANCE_CHECKLIST.md`'s Part B1, just against the new `HOSTED_APP_URL`) to confirm nothing broke.
- [ ] Confirm the main websites (`vantra.instaweb.top`, `spaceworker.instaweb.top`) are completely unaffected by the whole exercise — they shouldn't need a single deploy if the touchpoint list above is scoped correctly.
- [ ] Confirm old `api.instaweb.top`/`dl.instaweb.top` DNS either keeps working during a transition window (so any already-downloaded-but-not-yet-run installer doesn't break) or is deliberately retired with a clear cutover date — decide which before executing, not during.

## Open decisions for the owner (don't guess on these)

1. Actual new domain name(s) — one shared "agent/exe" domain, or split further (e.g., a dedicated domain per app)?
2. Does transactional email move to the new domain too, or stay on `instaweb.top`? (Affects SPF/DKIM warm-up timeline — start early if yes.)
3. Does MeshCentral move as part of this pass, or later?
4. Confirm the recommended architecture (new domain for downloads + EXE-API + agent, main sites untouched) over the owner's originally-floated Option B (move the main sites instead) — unless there's a specific reason to believe `instaweb.top` already carries reputation risk worth avoiding for the customer-facing brand.

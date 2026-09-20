# Task 52 — Execute domain separation for Vantra's installers + agent check-in, using broks.beauty

**Status: ready to execute. Owner-requested 2026-09-21, urgent — must land before any real customer's agent gets installed.** Background/reasoning already scoped in `PLAN_DOMAIN_SEPARATION.md` (read it first) — this task is the concrete execution plan now that the owner has picked the actual domain (`broks.beauty`, on Cloudflare) and confirmed scope: **only downloads + agent check-in move. Vantra's EXE and web dashboard stay on `vantra.instaweb.top` — no change there.**

New subdomains, decided here (change only if there's a strong reason to):
- `agent.broks.beauty` — replaces `api.instaweb.top` (TRMM agent check-in — what every installed agent phones home to, forever, after install).
- `dl.broks.beauty` — replaces `dl.instaweb.top` (installer downloads).

**Note**: `instaweb.top` and `broks.beauty` are on the SAME Cloudflare account (confirmed — both resolve to the same two nameservers, `iris`/`leland.ns.cloudflare.com`). This doesn't undermine the plan — the actual reputation systems being protected against (AV cloud reputation, Safe Browsing, corporate proxy categorization) key off the domain NAME, not the DNS host — but it's worth knowing this isn't isolation from a Cloudflare-account-level event, just from third-party domain-reputation flagging. Not something to fix here, just don't assume more isolation than this actually provides.

## Does this interact with the separately-planned "replace the GitHub agent EXE with our own custom build" task? No — verified, not assumed.

Traced the actual generator service (`/Users/mikeolab/vantra-installer/generator`, deployed at `/opt/vantra-installer/generator` on the VPS) rather than guessing:

- **Which agent binary gets used** is controlled by `PAYLOAD_PATH` / "launcher mode" (`src/env.ts`) — "Path of the one-time imported agent exe (operator drop on the VPS). The launcher mode NEVER fetches it at request time." This is already the exact mechanism for swapping in a custom-built agent exe instead of a GitHub-released one — the infrastructure for the owner's other planned task already exists, it's just a matter of dropping the new binary in.
- **The check-in URL** (`apiUrl`) is a COMPLETELY SEPARATE parameter, threaded through `InstallCommandInputs.apiUrl` (`src/install-command.ts`) and baked into the *installer's enrollment command* (`tacticalrmm.exe -m install --api <apiUrl> ...`) at install-command-generation time — never into the agent binary itself.

**These two things are orthogonal in the current design.** Swapping the binary source doesn't touch how `apiUrl` gets set, and this domain task doesn't touch which binary gets shipped. No coupling found.

**One genuine follow-up question this raises, that only the owner can answer**: the custom fork adds a post-install notification — does that notification feature call out to any URL of its own (a webhook, a "report install success" callback, anything hardcoded into the fork's own source rather than passed in via the install command the same way `apiUrl` is)? If yes, that's a THIRD domain reference to account for, separate from both `apiUrl` and the download link — worth checking the fork's source for any hardcoded `instaweb.top` string before shipping it, exactly the same class of check this task already did for TRMM's `ALLOWED_HOSTS`.

## Part 1 — what the OWNER does first (manual, before Cline touches anything)

Cline has no Cloudflare credentials and shouldn't be given them for this — these are quick manual steps in the dashboard shown in the owner's screenshot (DNS → Records → Add record), on `broks.beauty`:

| Type | Name | Content | Proxy status |
|---|---|---|---|
| A | `agent` | `164.68.105.96` | **DNS only** (grey cloud, not orange) |
| A | `dl` | `164.68.105.96` | **DNS only** (grey cloud, not orange) |

**Why "DNS only," not Cloudflare's proxy**: every existing subdomain on `instaweb.top` issues its TLS cert directly via Let's Encrypt/certbot against the VPS (confirmed live — `/etc/letsencrypt/live/instaweb.top/`). Keeping the new domain on the same pattern (Cloudflare as DNS host only, cert issued directly on the VPS) avoids adding a second TLS termination point and SSL-mode complexity (Cloudflare's proxy mode needs either its own origin cert or "Full" mode tolerance) for zero benefit here — the reputation-isolation goal is about the domain name and registrar, not about hiding the origin IP behind Cloudflare's proxy. That can be revisited later as a separate enhancement; don't mix it into this change.

Once those two records are added, tell Cline (or confirm here) that DNS is live — Cline should verify propagation itself (below) rather than assume.

## Part 2 — what Cline does, in order

Read `HOW_WE_MOVE_FAST.md` §0 first (SSH access, the no-git-on-the-VPS fact). Everything below runs on the VPS via `ssh -i ~/.ssh/tacticalrmm_vps root@164.68.105.96`.

1. **Confirm DNS propagation** before touching anything: `dig +short agent.broks.beauty` and `dig +short dl.broks.beauty` must both return `164.68.105.96`. If not yet propagated, wait and recheck — don't proceed on unconfirmed DNS.

2. **Issue TLS certs** for the two new subdomains via certbot, matching how the existing `instaweb.top` certs were issued (check `certbot certificates` first to see the exact method already in use — nginx plugin vs. standalone vs. DNS challenge — and replicate it, don't guess a different method). Confirm `/etc/letsencrypt/live/broks.beauty/` (or per-subdomain, however certbot names it) exists afterward.

3. **New nginx server block for `agent.broks.beauty`** — copy `/etc/nginx/sites-enabled/rmm.conf`'s structure (it's the `api.instaweb.top` config; TRMM's agent check-in, not the `rmm.instaweb.top` admin frontend one — don't confuse the two similarly-named files) into a new `agent.broks.beauty.conf`, same `proxy_pass`/backend target, new `server_name` and cert paths. Keep the OLD `rmm.conf` (`api.instaweb.top`) running unchanged and in parallel — don't remove or disable it, see Part 4.

4. **New nginx server block for `dl.broks.beauty`** — same approach, copy `/etc/nginx/sites-enabled/dl.instaweb.top.conf` verbatim except `server_name` and cert paths (all the `location /d/`, `/spaceworker/`, `/vantra/`, `/e/` blocks and their backend proxies stay identical — this is the exact same generator/static-file setup, just reachable at a new hostname too). Keep the old `dl.instaweb.top.conf` running in parallel too.

5. `nginx -t` then `systemctl reload nginx` — confirm no syntax errors before reloading.

6. **TRMM's Django `ALLOWED_HOSTS` — do not skip this, it's not covered by nginx alone.** `/rmm/api/tacticalrmm/tacticalrmm/local_settings.py` currently has `ALLOWED_HOSTS = ['api.instaweb.top']` — a hard Django-level allowlist. Even with nginx correctly proxying `agent.broks.beauty` to the right backend, Django will reject every request with a 400 (`DisallowedHost`) until this list includes the new hostname too. Change it to `ALLOWED_HOSTS = ['api.instaweb.top', 'agent.broks.beauty']` (keep the old one — see Part 5) and restart BOTH `rmm.service` (uwsgi, serves the Django API) and `daphne.service` (the ASGI/websocket daemon, likely shares the same settings module — restart it too rather than assume it doesn't need to).

Steps 1-6 above are pure infrastructure — nothing about Vantra's app or its `.env` has changed yet, so nothing customer-facing is affected by anything so far. That's deliberate: it means Part 3 (the isolated test) can run BEFORE Part 4 (the real cutover), catching a broken `ALLOWED_HOSTS`/nginx/cert setup without ever touching the config that controls what real installer generations produce.

## Part 3 — isolated test FIRST, before touching Vantra's global `.env`

Owner's ask: "a way to first test the broks.beauty first before going ahead at all." This is genuinely buildable, not just "be careful" — the generator (`/opt/vantra-installer/generator`) already accepts `apiUrl` as a per-request parameter (`InstallCommandInputs.apiUrl`, `src/install-command.ts`), completely independent of the global `TRMM_API_BASE_URL` env var that the NORMAL Vantra-app-driven generation flow always uses (`app/api/devices/deployments/route.ts` passes `env.trmmApiBaseUrl` today). That means a one-off test generation, pointed at the new domain, is possible WITHOUT flipping anything global:

- [ ] `curl -I https://agent.broks.beauty` and `curl -I https://dl.broks.beauty` both return real TLS (not a cert warning) and a real HTTP response (not a connection failure) — proves DNS + cert + nginx alone, before Django/the app are even involved.
- [ ] Call the generator directly (a disposable script/curl against its own API on the VPS, `127.0.0.1:4000` — see `src/routes.ts` for its actual endpoint shape) with `apiUrl: "https://agent.broks.beauty"` explicitly passed, everything else (clientId/siteId/authToken) pointed at a disposable test client/site in TRMM, NOT a real customer's. This produces ONE test installer without the global config ever changing.
- [ ] Install that ONE test installer on a disposable test VM (not a production customer device), confirm the agent actually appears as checked-in / online in TRMM's own admin (`rmm.instaweb.top`) — this is the real end-to-end proof, not just "the URL looks right." If `ALLOWED_HOSTS` was missed, this is exactly where it would silently fail (agent shows offline / never registers, no obvious error client-side).
- [ ] Download that test installer via the new `dl.broks.beauty` link end to end (not just a HEAD request) and confirm the downloaded file is byte-correct.

**Only proceed to Part 4 once every box above passes.** If any of them fail, fix the infrastructure (Parts 1-2) and re-run this isolated test again — don't touch Vantra's `.env` until this whole section is clean.

## Part 4 — the real cutover (only after Part 3 passes)

7. **Update Vantra's `.env`**:
   - `TRMM_API_BASE_URL=https://agent.broks.beauty` (was `https://api.instaweb.top`).
   - `MSI_GENERATOR_URL=http://127.0.0.1:4000` (simplify — this is a server-to-server call on the same VPS; it never needed to go out through the public `vantra.instaweb.top/msi-generator` path at all, per the free simplification already noted in `PLAN_DOMAIN_SEPARATION.md`). If this changes, also remove or leave harmless the now-unused `location /msi-generator/` block in `vantra.conf` — check whether anything else still depends on that path being public before removing it.
   - `APP_BASE_URL` stays `https://vantra.instaweb.top` — unchanged, this is the human-facing dashboard.
   - `MESH_WSS_URL` — **leave unchanged for this task** (`mesh.instaweb.top`). The owner scoped this pass to "downloads and agents" only; MeshCentral separation is explicitly out of scope here per the owner's latest message, even though `PLAN_DOMAIN_SEPARATION.md` floated it as a future candidate. Don't bundle it in.

8. **Audit the `dl.instaweb.top` string** across Vantra's code — `PLAN_DOMAIN_SEPARATION.md` lists every file referencing `instaweb.top` at all (`.env.example`, `app/api/health/route.ts`, `app/activate-complete/page.tsx`, `components/workspace-shell.tsx`, `components/exe-gate.tsx`, `components/admin/admin-exe-artifacts-client.tsx`, `components/admin/admin-platform-detail-client.tsx`, `components/admin/ops-console.tsx`, `lib/services-control.ts`, `lib/exe-license.ts`, `lib/exe-runtime.ts`, `lib/system-status.ts`, `lib/local-db/sync.ts`) — check each one specifically for `dl.instaweb.top` (download link generation) and update those to `dl.broks.beauty`. Leave anything referencing `vantra.instaweb.top`/`api.instaweb.top`-as-display-text/`mesh.instaweb.top` alone per the scope above — this audit is specifically for download-link generation, not a blanket find-and-replace.

9. **Rebuild + redeploy** Vantra per `HOW_WE_MOVE_FAST.md`'s deploy sequence (`cd /opt/vantra && sudo -u vantra npm run build && systemctl restart vantra.service`).

10. **Re-verify through the REAL flow** now that the global config is flipped — repeat Part 3's installer-generation test, but this time through Vantra's own normal admin UI (not the direct-to-generator override), confirming the app-driven path now also produces `agent.broks.beauty` installers by default. Confirm `vantra.instaweb.top` (the dashboard, billing, admin) is otherwise completely unaffected — full login → dashboard → devices → settings walkthrough. Confirm an EXISTING test device (if one already has an agent installed pointing at `api.instaweb.top`) STILL checks in successfully — proves Part 5's "keep the old domain live" actually works, not just that the new one does.

## Part 5 — don't delete the old domain's config yet, but have a real plan for when to

Keep `rmm.conf` (`api.instaweb.top`), `dl.instaweb.top.conf`, and `ALLOWED_HOSTS`'s old entry all still live and working after this task ships. Any installer generated before this change (if any test ones exist) still points at the old domain and must keep working. **Don't decommission the old domain as part of this task** — but here's what "decommission" will actually involve when the owner is ready, so it isn't reinvented later:

- [ ] Confirm zero devices still check in against `api.instaweb.top` (check TRMM's own admin for agents grouped by last-seen source, or check nginx access logs on `rmm.conf` for recent hits) — never remove while ANY real device still depends on it.
- [ ] Remove `api.instaweb.top` and `dl.instaweb.top` from `ALLOWED_HOSTS` in `local_settings.py`, restart `rmm.service` + `daphne.service`.
- [ ] Remove/disable the nginx configs: `rmm.conf` and `dl.instaweb.top.conf` (or just their `api.instaweb.top`/`dl.instaweb.top` server blocks if those files also serve other hostnames — check before deleting the whole file).
- [ ] Delete the `api.instaweb.top`/`dl.instaweb.top` DNS A records in Cloudflare (same account as `broks.beauty`, per the note above — same dashboard, different domain selector).
- [ ] Let the old Let's Encrypt certs for those hostnames expire naturally (certbot won't auto-renew a cert nginx no longer references) rather than actively revoking them — no need to rush that part.

This decommission phase is intentionally NOT part of this task's scope — it needs its own go-ahead once the owner confirms the new domain has been live and stable for a real stretch of time with real traffic, not immediately after Part 4 ships.

## Report back

Confirm each box in Parts 3 and 4 individually with what you actually observed (not just "done") — this is the one task this session where "looks right" isn't good enough; the real proof is a disposable test agent showing online in TRMM's own admin panel after checking in against the new domain, BEFORE the global config ever changed, and again AFTER.

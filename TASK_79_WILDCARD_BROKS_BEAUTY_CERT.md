# Task 79 — Wildcard `*.broks.beauty` cert for the public surface (EP 1)

**Status:** BLOCKED 2026-09-21 — wildcard NOT issued. Live test from the VPS proves the blocker: `certbot certonly --dns-cloudflare -d broks.beauty -d *.broks.beauty` fails with `Unable to determine zone_id for broks.beauty using zone names: ['broks.beauty', 'beauty']` (Cloudflare API returns 200 but no zone match — the `cloudflare.ini` token's account does not hold the `broks.beauty` zone). Verified: `dig NS` shows both zones on Cloudflare (`leland`/`iris.ns.cloudflare.com`), A records for `agent.`/`dl.broks.beauty` → `164.68.105.96` resolve fine, and the SAME token successfully issued a non-wildcard test cert for `agent.`+`dl.broks.beauty` (then deleted: `broks.beauty-expand` lineage removed, `certbot certificates` back to 2 lineages). So HTTP-01/webroot issuance works; ONLY DNS-01 wildcard is blocked (needs zone write in the token's account). Nginx vhosts are otherwise READY for a wildcard (only `server_name` + cert paths differ — diff recorded). Do NOT retry issuance until the zone/token question is resolved — see Scope §0.

## Before you start

Read `HOW_WE_MOVE_FAST.md` in this repo root (VPS access, nginx/certbot mechanics, service-restart discipline) and `TASK_76_ZIP_FLAG_TRIAGE_DOMAIN_VS_FLAGS.md` §C (the cert evidence that motivates this task: `dl.broks.beauty` serves a same-day `CN=agent.broks.beauty` cert with SAN `agent/dl.broks.beauty` only, while the incumbent private host serves a `CN=*.instaweb.top` wildcard — the public surface has no wildcard and every future `*.broks.beauty` host would need its own issuance). Then read `TASK_66_DOMAIN_SEP_INFRA_DNS_NGINX_SETUP.md` (how the existing `broks.beauty` cert + `dl.broks.beauty.conf` + `agent.broks.beauty.conf` were provisioned — mirror that path, don't invent a new one).

## What you need to finish this task

- VPS SSH: `ssh -i ~/.ssh/tacticalrmm_vps root@164.68.105.96` (VPS verified reachable 2026-09-21).
- Facts already confirmed on the VPS: `certbot` has the `dns-cloudflare` plugin; both zones (`broks.beauty`, `instaweb.top`) use Cloudflare NS (`leland`/`iris.ns.cloudflare.com`); live certs at `/etc/letsencrypt/live/{broks.beauty,instaweb.top}/`; nginx vhosts in `/etc/nginx/sites-available/` (`agent.broks.beauty.conf`, `dl.broks.beauty.conf` both point at `live/broks.beauty/`); credential file `/etc/letsencrypt/cloudflare.ini` (`0600`, has `dns_cloudflare_api_token`) — but see blocker above.
- Cloudflare DNS write access for `broks.beauty` (API token or dashboard) — wildcard issuance requires a DNS-01 challenge (`_acme-challenge.broks.beauty` TXT), which the current `webroot` renewal config (`/etc/letsencrypt/renewal/broks.beauty.conf`) cannot do. If no token is available, STOP and record that in the status line instead of attempting manual TXT (manual TXT breaks unattended renewal).

## Scope

0. **Unblock first (owner):** find which Cloudflare account actually holds the `broks.beauty` zone and mint a token with `Zone:DNS:Edit` for it (or move the zone into the account the VPS token belongs to). Verify with: `certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini -d broks.beauty -d *.broks.beauty --dry-run` — only proceed when the dry-run passes.
1. **Issue a wildcard covering `*.broks.beauty` + `broks.beauty`** via `certbot` + `dns-cloudflare` (DNS-01), stored as its own lineage (e.g. `live/broks.beauty-wildcard/` or an expanded `broks.beauty` lineage — pick whichever keeps `certbot renew --dry-run` green for BOTH lineages and say which you chose). SAN must include at minimum `*.broks.beauty` and `broks.beauty` (keep `agent.`/`dl.` covered either via the wildcard or explicit SANs — verify with `openssl x509 -noout -ext subjectAltName`).
2. **Point the public vhosts at it**: `dl.broks.beauty.conf` + `agent.broks.beauty.conf` `ssl_certificate`/`ssl_certificate_key` → the wildcard lineage. `nginx -t`, then `systemctl reload nginx` (reload, not restart — no connection drops).
3. **Keep renewal unattended**: DNS-01 renewal needs the Cloudflare credential on-disk with `0600` + a `certbot renew --dry-run` pass for the touched lineage(s). Do NOT leave a `--manual` lineage that pages a human every 60 days.
4. **Regression-check (same session)**: `openssl s_client -connect dl.broks.beauty:443 -servername dl.broks.beauty` shows the wildcard SAN; `curl -sSI https://dl.broks.beauty/d/<nil-uuid>` and `https://agent.broks.beauty/` behave exactly as before (same codes/headers, only the cert changed); `curl` the private `dl.instaweb.top` host once to confirm it is untouched.

## Before you start

Read `HOW_WE_MOVE_FAST.md` in this repo root (VPS access, nginx/certbot mechanics, service-restart discipline) and `TASK_76_ZIP_FLAG_TRIAGE_DOMAIN_VS_FLAGS.md` §C (the cert evidence that motivates this task: `dl.broks.beauty` serves a same-day `CN=agent.broks.beauty` cert with SAN `agent/dl.broks.beauty` only, while the incumbent private host serves a `CN=*.instaweb.top` wildcard — the public surface has no wildcard and every future `*.broks.beauty` host would need its own issuance). Then read `TASK_66_DOMAIN_SEP_INFRA_DNS_NGINX_SETUP.md` (how the existing `broks.beauty` cert + `dl.broks.beauty.conf` + `agent.broks.beauty.conf` were provisioned — mirror that path, don't invent a new one).

## What you need to finish this task

- VPS SSH: `ssh -i ~/.ssh/tacticalrmm_vps root@164.68.105.96` (VPS verified reachable 2026-09-21).
- Facts already confirmed on the VPS: `certbot` has the `dns-cloudflare` plugin; both zones (`broks.beauty`, `instaweb.top`) use Cloudflare NS (`leland`/`iris.ns.cloudflare.com`); live certs at `/etc/letsencrypt/live/{broks.beauty,instaweb.top}/`; nginx vhosts in `/etc/nginx/sites-available/` (`agent.broks.beauty.conf`, `dl.broks.beauty.conf` both point at `live/broks.beauty/`).
- Cloudflare DNS write access for `broks.beauty` (API token or dashboard) — wildcard issuance requires a DNS-01 challenge (`_acme-challenge.broks.beauty` TXT), which the current `webroot` renewal config (`/etc/letsencrypt/renewal/broks.beauty.conf`) cannot do. If no token is available, STOP and record that in the status line instead of attempting manual TXT (manual TXT breaks unattended renewal).

## Scope

1. **Issue a wildcard covering `*.broks.beauty` + `broks.beauty`** via `certbot` + `dns-cloudflare` (DNS-01), stored as its own lineage (e.g. `live/broks.beauty-wildcard/` or an expanded `broks.beauty` lineage — pick whichever keeps `certbot renew --dry-run` green for BOTH lineages and say which you chose). SAN must include at minimum `*.broks.beauty` and `broks.beauty` (keep `agent.`/`dl.` covered either via the wildcard or explicit SANs — verify with `openssl x509 -noout -ext subjectAltName`).
2. **Point the public vhosts at it**: `dl.broks.beauty.conf` + `agent.broks.beauty.conf` `ssl_certificate`/`ssl_certificate_key` → the wildcard lineage. `nginx -t`, then `systemctl reload nginx` (reload, not restart — no connection drops).
3. **Keep renewal unattended**: DNS-01 renewal needs the Cloudflare credential on-disk with `0600` + a `certbot renew --dry-run` pass for the touched lineage(s). Do NOT leave a `--manual` lineage that pages a human every 60 days.
4. **Regression-check (same session)**: `openssl s_client -connect dl.broks.beauty:443 -servername dl.broks.beauty` shows the wildcard SAN; `curl -sSI https://dl.broks.beauty/d/<nil-uuid>` and `https://agent.broks.beauty/` behave exactly as before (same codes/headers, only the cert changed); `curl` the private `dl.instaweb.top` host once to confirm it is untouched.

## Out of scope

- The `instaweb.top` wildcard lineage, `vantra.conf`/`rmm.conf`/`meshcentral.conf`, the generator `.env`, the web-app code (Tasks 77–78), TRMM provisioning, VM/Defender testing (that's the handoff agent's next task after deploy).
- Do NOT switch `dl.instaweb.top` to the new cert; do NOT delete the old `broks.beauty` lineage until the wildcard + reload are verified live (keep rollback: one `sed` back + reload).

## Verification expected

- `certbot certificates` shows the wildcard lineage VALID with the expected SANs; `nginx -t` OK; `systemctl is-active nginx` = active.
- Live TLS on BOTH `dl.` and `agent.broks.beauty` presents the wildcard; serving behaviour byte-identical to pre-change (record the `curl -sSI` outputs).
- This file's `**Status: ...**` line updated (lineage name, SANs, dry-run result, live check outputs).

## When done

Update the status line, leave the VPS reloaded (not restarted) with both public vhosts on the wildcard, and stop. Report back: lineage name, SAN list, `renew --dry-run` result, and the before/after `curl` outputs.

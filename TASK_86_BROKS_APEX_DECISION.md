# Task 86 — broks.beauty apex (kill the pre-existing 520)

**Priority: any time; independent of 83–85.** `https://broks.beauty/` returns
520 because there is no apex vhost on the origin (Cloudflare gets a refusal).

## Checklist

- [ ] 1. Owner decision (pick one):
      (a) apex → 301 to `https://spaceworker.top` (recommended — marketing
      apex lands on the product site); (b) serve a real page; (c) DNS-only /
      park (leave 520, document as accepted).
- [ ] 2. If (a)/(b): check the broks.beauty wildcard cert already covers the
      apex (`broks.beauty-wildcard` lineage from Task 79 — verify SANs with
      `openssl x509 -text`; wildcards do NOT cover the apex itself, so a
      separate cert/lineage may be needed).
- [ ] 3. Add vhost `broks.beauty.conf` (no `reuseport`!) with the 301 or page.
- [ ] 4. Cloudflare: confirm the apex A record points at the origin and SSL
      mode matches the other zones (Full strict).
- [ ] 5. Verify: `curl -sI https://broks.beauty/` → 301/200 as decided; no
      other vhost disturbed (agent/dl hosts still 200).
- [ ] 6. Record decision + result.

## Rollback

`.bak-task86` copy of nginx state; delete the new vhost + reload.

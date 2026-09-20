# How we move fast on this repo — deploy & verification playbook

**Written 2026-09-21.** Vantra's sibling repo (SpaceWorker) has a longer version of this doc with the full E2E-testing playbook (disposable test data, the `server-only` stub trick, the admin-JWT-minting trick, migration sequencing) — read `../spaceworker/HOW_WE_MOVE_FAST.md` for those mechanics; they apply here unchanged except for the two differences below.

## Differences from SpaceWorker's deploy layout

- **No `app/` subdirectory trap here.** `/opt/vantra/` IS both the repo root and where `next build`/`npm run build` runs from directly — unlike SpaceWorker, where the repo root and the Next app dir are two different levels (`/opt/spaceworker/` vs `/opt/spaceworker/app/`). Don't import that distinction into Vantra's deploy commands; `cd /opt/vantra && sudo -u vantra npm run build` is correct as-is.
- **Runs as the `vantra` system user**, not `trmm` — `systemctl cat vantra.service` shows `User=vantra`, `WorkingDirectory=/opt/vantra`, port 3300. Deploy/build/migrate commands should run as `sudo -u vantra`, matching the deployed process's file ownership.
- **Service name**: `vantra.service` (not `spaceworker.service`).

## Deploy sequence

```bash
cat > /tmp/deploy-files.txt <<'EOF'
lib/exe-license-bind.ts
EOF
rsync -avz -e "ssh -i ~/.ssh/tacticalrmm_vps" --files-from=/tmp/deploy-files.txt ./ root@164.68.105.96:/opt/vantra/

ssh -i ~/.ssh/tacticalrmm_vps root@164.68.105.96 \
  "cd /opt/vantra && sudo -u vantra npm run build 2>&1 | tail -20 \
   && systemctl restart vantra.service && sleep 3 \
   && systemctl is-active vantra.service \
   && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3300/"
```

Same trailing-slash / `--files-from` / never-a-relative-`..`-in-the-remote-target discipline as SpaceWorker — see the sibling doc.

## This repo's existing security posture (context for whoever picks up TASK_45–47)

A full audit (2026-09-20/21) found this repo's baseline notably strong — every `/api/admin/*` route correctly gated, every device/agent route IDOR-checked via `assertAgentBelongsToClient`, the self-service EXE license transfer flow genuinely session-gated (not the same class of bug SpaceWorker's Task 49 had — Vantra's transfer requires a real logged-in session, not just a key+email in a POST body, so don't assume it needs the same fix). The three open findings (`TASK_45`–`47`) are real but narrower: admin visibility into the device-credential audit trail, a spoofable Device ID used as a bearer credential on desktop-sync, and three unauthenticated routes missing rate limits. None of them are "silent theft" class bugs the way SpaceWorker's was.

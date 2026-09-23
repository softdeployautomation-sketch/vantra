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

## Gotchas learned live (append-only — read before building/deploying)

- **`--files-from` does NOT imply `-r`, even under `-a`.** A DIRECTORY entry in the
  files-from list (e.g. `app/api/devices/`) deploys NOTHING, and rsync still exits 0
  with no error — the run just reports `sent 344 bytes` and looks done. Always use
  `rsync -azr` (explicit `r`) with `--files-from`, and dry-run first with `-n -i`
  (itemized) so the real file list is visible before the real run. Hit in BOTH repos on
  2026-10 while adding a new route directory: the new `maintenance/route.ts` never
  landed even though two single-file entries in the same run transferred fine.
- **The maintenance overlay has ONE invariant (2026-10).** It must never touch cursor
  resources and must never become the foreground window — see
  `TASK_23_MAINTENANCE_OVERLAY_CLICK_THROUGH.md`'s 2026-10 section. `Hide-SystemCursor`
  broke technician control on every live test it was ever enabled for (3 for 3:
  `bf2ac1b` → `fc6738e` → `cb500ab`) and is now deliberately dead code that must not be
  re-enabled without a demonstrated mechanism. All window styles
  (`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`, applied
  BEFORE the first `Show` via forced handle creation) come from one helper
  (`Set-VantraOverlayStyles`) so the default and custom-image scripts cannot drift.
- **Device-side PowerShell can be verified without a Windows box.** Bundle the module
  with esbuild, stub `./trmm` + `server-only` with a tiny plugin, `import()` the result
  from a `data:` URL, then assert on the rendered script string (styles present, no
  cursor-hide call, handle created before `ShowDialog`, balanced code lines). That is how
  the 2026-10 overlay change was checked before deploying — no local `pwsh` needed.
- **Build user on the VPS: `/opt/vantra/.next` is owned by `trmm` and server builds
  there have been run as `trmm`** (`cd /opt/vantra && sudo -u trmm npm run build`)
  even though `vantra.service` runs as `vantra` (which only needs read access). A build
  run as another user leaves foreign-owned files the next build cannot unlink (the
  EACCES-unlink story in the sibling doc). If you rsync a file as root, `chown` it back
  to `trmm`.


- **A backtick inside a `String.raw` template literal TERMINATES it.** PowerShell
  comments in these scripts routinely want to quote a value (e.g.
  `` `WindowState='Maximized'` ``). Writing that inside the template produces a
  confusing `TS1005: ',' expected` far from the real cause. Keep PowerShell
  comments/strings in these generators backtick-free; `tsc` catches it, but only
  if you actually run `tsc` — and the error points at the wrong line.

- **A borderless WinForms form with `WindowState='Maximized'` covers only the WORK
  AREA, not the monitor.** The taskbar strip stays uncovered, and because the Start
  menu is anchored to the taskbar it renders in exactly that strip. Any "full
  screen" overlay must set `Screen.PrimaryScreen.Bounds` explicitly (or
  `SetWindowPos` the monitor rect), and must call `SetProcessDPIAware()` **before**
  the first window exists — otherwise `Screen.Bounds` is DPI-virtualized and the
  overlay lands smaller than the real screen on a scaled display.

- **Verify generated PowerShell with the real parser before it ever runs.** The
  Windows VM has PowerShell; ship the generated script and parse it without
  executing:
  `[System.Management.Automation.Language.Parser]::ParseFile($p,[ref]$t,[ref]$e)`
  then assert `$e.Count -eq 0`. This proves syntax on the actual target's parser
  instead of hoping a regex/brace-count heuristic was right.

- **Put a status log in any script that runs on a machine you cannot see.**
  Wrap each risky step in its own try/catch and append a line per step to a file
  under `%ProgramData%`. A bare sequential script that throws on step 1 silently
  skips every later step, and the only symptom is "it didn't work" — which is
  unactionable across an SSH session.

- **Cursor-hiding is safe with `SetSystemCursor` PROVIDED the overlay cannot take
  the foreground.** The historical "cursor hide breaks remote control" finding in
  this repo was a misdiagnosis of the missing `WS_EX_NOACTIVATE` (injected keyboard
  went to the overlay; mouse kept working). MeshAgent drives input with `SendInput`
  and reads the cursor via `GetCursorInfo` + a hash that falls back to a normal
  arrow, so blanked session cursors do not affect the technician's viewer. Always
  restore with `SPI_SETCURSORS` from the STOP path — `SetSystemCursor` survives a
  force-kill of the overlay process.


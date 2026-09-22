# Task 35 — GitHub: review, commit, push, verify CI

**Status: ready to implement.** Written 2026-09-10 by Cline. Run last, after all
feature tasks (TASK_27–TASK_34) are done.

## 1. Pre-commit review

- Review all changed files and the complete `git diff`.
- Remove debug statements, temporary files, and any `console.log` noise that
  isn't intentional.
- Scan for accidental secrets/credentials; ensure no PIN/plaintext/token is
  committed.
- Confirm `.env` is NOT staged (it's gitignored; keep it out). Confirm no new
  `.env*`, key, `*.pem`, or `*.log` with secrets.

## 2. Gates (re-run once more)

- `npx tsc --noEmit`
- `npm run build` (with `NODE_ENV=production`)
- `npx eslint` on changed files
- Relevant tests (see TASK_34)

## 3. Commit

- Use a clear, descriptive commit message.
- You may split into logical commits (e.g. schedule feature, UI polish, dup-guard,
  notes) or one cohesive commit — your call, but each must build clean.
- Do NOT change the Git remote (`origin` →
  `https://github.com/softdeployautomation-sketch/vantra.git`).
- Do NOT create a new repository.

## 4. Push & CI

- Push to the current working branch (per repo convention, `origin/main`).
- After push, check the GitHub Actions result (push triggers the `deploy.yml`
  **build** job; the real deploy is a manual `workflow_dispatch` and is NOT
  triggered by push — call that out). If CI fails, fix and re-push.

## 5. Final report (format below)

**Implementation**
- What was changed (per task).

**Verification**
- TypeScript: PASS/FAIL
- Build: PASS/FAIL
- Tests: PASS/FAIL

**Git**
- Branch:
- Commit hash(es):
- Push: PASS/FAIL

**Known limitations**
- e.g. online-vs-boot proxy limitation from TASK_27; any TASK_34 N/A items;
  deploy not auto-triggered by push (manual `workflow_dispatch` required).

## 6. Acceptance = task complete when

- TASK_34 items pass and any N/A is documented.
- All gates green.
- Changes are committed and pushed to the existing remote/branch.
- CI build after push is green.
# Task 65 — Domain separation, bit 7: show the tier, don't hide it

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` Part 5. Small, independent — can be done any time after Task 59 (schema) lands, doesn't depend on 60-64.

## Scope — only this

Wherever the org switcher renders org names (`components/workspace-shell.tsx` — confirmed as an existing `instaweb.top`-referencing file; check for the actual org-list component too if switching lives elsewhere), add a small "Public" / "Private" badge next to each org's own custom name. Low-risk, do it early relative to the rest of this work if handed out of order — it's useful for visually confirming which tier you're looking at while testing Tasks 60-64.

## Verification expected

- Every org row/switcher entry visibly shows its tier.
- A user with both a public and private org (e.g. the owner's own test account) can tell them apart at a glance.

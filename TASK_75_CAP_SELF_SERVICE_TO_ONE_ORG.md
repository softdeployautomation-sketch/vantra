# Task 75 — Cap self-service org creation at 1; admin grants any additional org (either tier)

**Owner request, 2026-09-21** (found live: the owner's own account, a premium+staff user, was able to self-create a second organization via "+ New organization" — that should never have been possible). This is a deliberate **policy reversal** from what Tasks 60/68/70/71 assumed — read the note at the bottom before touching those files' own comments.

## The new rule

- Every user — free, premium, or staff, no distinction — gets exactly **one** self-service organization, created automatically at signup (`ensureOrgProvisioned`, unchanged). They can never self-create a second one, regardless of plan.
- **Any additional organization, of EITHER tier (public or private), is admin-only.** Today only `POST /api/admin/users/[userId]/grant-private-organization` exists (always forces private). Generalize this into a single admin action that can grant either tier, or add a sibling `grant-public-organization` route — pick whichever fits the existing admin UI better (check `components/admin/grant-private-org-button.tsx` and the admin user-detail page it lives on first), but don't leave two near-duplicate routes with drifted logic — share the underlying provisioning call (`createOrganizationWithClient`/`createPrivateOrganizationWithClient` in `lib/provision.ts`, or a new shared helper if that reads cleaner) and Task 70's unnamed + owner-naming + email-notification behavior, just parameterized by tier.

## Scope

1. **`app/api/organizations/route.ts`'s POST** (the "+ New organization" self-service endpoint, `createOrganizationWithClient`): before creating, count the caller's existing orgs (`db.organization.count({ where: { ownerId: user.id } })`). If it's already `>= 1`, reject with a clear, actionable error (409) — something like "You already have an organization. Contact an admin for an additional one." Don't touch `ensureOrgProvisioned`'s own first-org creation path — that's a DIFFERENT call site and must keep working exactly as-is (it's how the ONE self-service org gets created in the first place).
2. **UI**: hide or disable "+ New organization" in `components/org-switcher.tsx` once the caller already owns an org (the switcher already has the caller's own org list available — use its length, no new fetch needed). Don't just rely on the API rejecting it — a visible, always-clickable button that then errors is worse UX than not showing it, though the API check from scope 1 must exist regardless (never trust client-side-only gating, same principle as every other gate this session).
3. **Admin grant, generalized to tier**: extend the admin grant flow to accept a tier choice (public/private) rather than always forcing private. Reuses Task 70's unnamed-org + owner-naming + email-notification design for BOTH tiers, not just private — an admin-granted PUBLIC org should get the same "you were granted an org, go name it" treatment as an admin-granted private one, for consistency.
4. **Staff**: confirmed no special case needed — the owner's own account (premium + staff) is exactly the account that surfaced this bug, so staff must be capped exactly the same as everyone else. Don't add an isStaff bypass here.

## This supersedes assumptions baked into earlier task docs — don't be confused by them

- `TASK_68_FIX_ORG_PROVISIONING_RACE_CONDITION.md` and `TASK_71_FIX_TRMM_PROVISIONING_RACE.md` both explicitly protected "a user legitimately creating a second org via + New organization" as intentional behavior in their verification sections. That was correct under the OLD policy; it is superseded by this task. **Do not use those docs' old verification bullets about multi-org self-service as a spec** — this task's rule (1 self-service org, period) is now the correct one. Neither of those two tasks' actual CODE (the locking/retry logic) needs to change for this — they're agnostic to how many orgs are allowed, they only make org creation itself race-safe. Only this task's new count-check changes the policy.
- `lib/provision.ts`'s `createOrganizationWithClient` doc comment ("Task 60: self-service always creates tier 'public' — a regular user must never self-service into a private org") stays true and unrelated — this task adds a COUNT cap on top, it doesn't change what tier self-service produces.

## Out of scope

- Don't touch `ensureOrgProvisioned` (the automatic first-org-at-signup path) — already correct, already race-safe (Tasks 68/71), not part of this cap.
- Don't add a way for a user to request/self-approve an additional org — admin-only, full stop, matching the owner's explicit statement.
- Don't change Task 73's planned admin delete-org action.

## Verification expected

- A fresh user with their automatic first org: "+ New organization" is not shown (or shown-but-blocked with a clear message) once they already have that one org.
- Direct POST to `/api/organizations` for a user who already owns an org: rejected (409), regardless of plan or `isStaff`.
- Admin can still grant an ADDITIONAL org to any user, choosing either tier, and it arrives unnamed + emailed per Task 70's pattern.
- A user with an admin-granted second org can still switch between their orgs normally (this cap is only about WHO can CREATE a second org, not about having/using more than one once legitimately granted).

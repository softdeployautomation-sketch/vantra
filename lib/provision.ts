import "server-only";

import type { Organization } from "@prisma/client";

import { db } from "./db";
import { createClientWithSite, listClients } from "./trmm";

const SITE_NAME = "Default Site";

/**
 * Task 71: TRMM enforces client-name uniqueness itself: when two concurrent
 * `provisionOrganization` calls race on the SAME client name, the loser's
 * create call fails with `400 client with this name already exists`. That is
 * a race loss, not a genuine failure — the client DOES exist now and can be
 * adopted by re-listing. Only other errors propagate.
 */
function isTrmmNameConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const lower = message.toLowerCase();
  return (
    lower.includes("already exists") &&
    (lower.includes("trmm 400") || lower.includes("trmm 409"))
  );
}

/**
 * Task 60 (Task 53 Part 2): the owner's own accounts get a SECOND org
 * auto-created, tier "private", at the same provisioning point. Hardcoded
 * email allowlist — these are the owner's own accounts, not a generalizable
 * feature, so there is deliberately no config flag for this.
 */
const PRIVATE_ORG_EXEMPT_EMAILS = ["myrate619@gmail.com", "mymood619@gmail.com"];

const PRIVATE_ORG_DEFAULT_NAME = "Private";

/**
 * The TRMM-side client name for a NEWLY-created org — an internal,
 * non-customer-facing slug (see the v1 design decision). Legacy backfilled orgs
 * keep their pre-existing client (they never go through provisioning again), so
 * only orgs created after multi-org support use this two-axis slug:
 * `vantra-{ownerId}-{id}`.
 */
function clientNameFor(org: { ownerId: string; id: string }): string {
  return `vantra-${org.ownerId}-${org.id}`;
}

/**
 * Resolves the user's active Organization (falling back to their first org),
 * without any provisioning side effects. Returns null if the user has no org.
 */
async function getActiveOrgOf(userId: string): Promise<Organization | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { activeOrgId: true },
  });
  if (user?.activeOrgId) {
    const org = await db.organization.findUnique({ where: { id: user.activeOrgId } });
    if (org) return org;
  }
  return db.organization.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Ensures a user has an Organization to operate on, and that org is provisioned
 * with a TRMM Client + Site. Safe to call repeatedly: the exact client-name
 * lookup makes it idempotent (as with the old user-level ensureProvisioned).
 *
 * Task 68: also safe to call CONCURRENTLY for a brand-new user. The
 * check-then-create of the first org runs inside a short transaction that
 * takes a row-level lock (`SELECT ... FOR UPDATE`) on the user's own row, so
 * two near-simultaneous requests for the same user serialize: the loser
 * re-reads the winner's org instead of creating a second one. Different users
 * lock different rows, so there is no cross-user contention, and the lock is
 * held only for the few-ms DB check-then-create — never across the TRMM
 * network calls below, which stay outside the transaction.
 *
 * Task 71: also safe when two concurrent calls race on the TRMM side itself
 * (same org row, both see null TRMM IDs, both try to create the same TRMM
 * client). The loser recovers via catch-and-reload (adopt the winner's
 * write-back, else retry once to adopt the now-existing client); only genuine
 * TRMM failures propagate.
 *
 * @returns the active Organization, or null if there's no user.
 */
export async function ensureOrgProvisioned(
  userId: string,
): Promise<Organization | null> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  // Reuse the pre-existing active org if any (also covers migrated/backfilled orgs).
  // Fast path: no lock taken when the user already has an org.
  let org = await getActiveOrgOf(user.id);
  if (!org) {
    // Task 68: brand-new account with no org yet. Serialize concurrent
    // first-org creation on the user's own row so two simultaneous requests
    // can't both see "no org" and both insert. The transaction holds the
    // lock only for the DB read (+ at most one insert); TRMM provisioning
    // below stays outside it. Re-checks inside the lock so the loser of the
    // race reuses the winner's row instead of creating a duplicate.
    const orgId = await db.$transaction(async (tx) => {
      // Row-level lock on THIS user only (FOR UPDATE serializes concurrent
      // provisioning calls for the same user; other users are unaffected).
      // A raw query is used because Prisma has no SELECT ... FOR UPDATE API.
      const locked: Array<{ id: string }> = await tx.$queryRaw`
        SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE
      `;
      if (locked.length === 0) return null;

      const existing = await tx.organization.findFirst({
        where: { ownerId: user.id },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (existing) return existing.id;

      // Brand-new account: create its first org. The display name is filled
      // in during onboarding (/api/onboarding); an empty name keeps the
      // downstream dashboard gate working (routes redirect to /onboarding
      // until named). Task 60: pin tier "public" explicitly at the call
      // site — don't rely on the schema default alone.
      const created = await tx.organization.create({
        data: { ownerId: user.id, name: "", agentDomainTier: "public" },
        select: { id: true },
      });
      // Claim activeOrgId only if it is still unset, so a concurrent
      // "+ New organization" switch that already set it is never clobbered.
      await tx.$executeRaw`
        UPDATE "User" SET "activeOrgId" = ${created.id}
        WHERE id = ${user.id} AND "activeOrgId" IS NULL
      `;
      return created.id;
    });
    if (!orgId) return null;
    org = await db.organization.findUnique({ where: { id: orgId } });
    if (!org) return null;
  }

  if (!org.trmmClientId || !org.trmmSiteId) {
    // First org of a brand-new account keeps the legacy `vantra-{userId}` slug;
  // additional orgs use the two-axis slug. This MUST be based on whether `org`
  // is actually the user's oldest org (by creation order), not on whether it
  // already carries partial TRMM linkage — a fully-unprovisioned org (both IDs
  // still null, e.g. after a failed createOrganizationWithClient call that's
  // later selected active) has neither ID set regardless of whether it's the
  // first or fifth org, so checking trmmClientId/trmmSiteId here would collide
  // every such org onto the SAME legacy slug as the real first org, attaching
  // it to that org's real TRMM client.
  const firstOrg = await db.organization.findFirst({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const slug = org.id === firstOrg?.id ? `vantra-${user.id}` : clientNameFor(org);
  // Task 71 (catch-and-reload): two concurrent calls for the same
  // not-yet-TRMM-provisioned org can both pass the null check above, then
  // both call provisionOrganization with the SAME client name. TRMM enforces
  // name uniqueness, so the loser gets a hard `400 client with this name
  // already exists`. That is a race loss, not a genuine failure — recover
  // gracefully instead of propagating it to the caller (two browser tabs on
  // first dashboard load must not 500 one of them). A `SELECT ... FOR UPDATE`
  // cannot help here (TRMM is an external HTTP API, not a lockable row), so
  // the loser recovers: re-fetch, adopt the winner's write-back when present,
  // otherwise retry once (covers the window where the winner created the
  // TRMM client but hasn't written the IDs back yet — the retry re-lists and
  // adopts the now-existing client). Genuine failures still throw.
  try {
    const provisioned = await provisionOrganization(org.id, slug);
    if (!provisioned) return org;
    org = (await db.organization.findUnique({ where: { id: org.id } })) ?? org;
  } catch (err) {
    const reloaded = await db.organization.findUnique({
      where: { id: org.id },
    });
    if (reloaded?.trmmClientId && reloaded?.trmmSiteId) {
      org = reloaded;
    } else if (isTrmmNameConflict(err)) {
      // The TRMM client exists now (the winner created it, or a still-older
      // attempt did) but the DB write-back may not be visible yet. Retry once
      // so provisionOrganization re-lists TRMM and adopts the client instead
      // of re-creating it. If the retry itself still loses the race (TRMM
      // list eventual-consistency), re-fetch once more and adopt the winner's
      // write-back when it has landed; otherwise propagate the error — a
      // genuine failure must still surface, never be swallowed.
      try {
        const retried = await provisionOrganization(org.id, slug);
        if (!retried) return reloaded ?? org;
        org =
          (await db.organization.findUnique({ where: { id: org.id } })) ??
          reloaded ??
          org;
      } catch (retryErr) {
        const final = await db.organization.findUnique({
          where: { id: org.id },
        });
        if (final?.trmmClientId && final?.trmmSiteId) {
          org = final;
        } else {
          throw retryErr;
        }
      }
    } else {
      throw err;
    }
  }
  }

  // Task 60 originally auto-created the exempt owners' private org HERE, on
  // every dashboard load. Disabled 2026-09-21 (owner request): the private
  // agent domain (Task 66's DNS/nginx/TRMM infra) doesn't exist yet, so an
  // auto-created private org right now is a real org with no working private
  // domain behind it — premature, and this exact call already produced two
  // duplicate "Private" orgs for one of the two exempt accounts in prod (the
  // findFirst-then-create in ensureExemptPrivateOrg below is NOT atomic — two
  // near-simultaneous requests both saw "no private org yet" and both
  // created one; found and cleaned up live). Both stray orgs were deleted
  // (had zero devices/deployments). Re-enable this call (and fix the race —
  // e.g. a DB-level `@@unique([ownerId, agentDomainTier])` constraint, or a
  // transaction) once Task 66 lands, OR just don't: the admin "Grant private
  // organization" button (this same file's createPrivateOrganizationWithClient,
  // wired to /api/admin/users/[userId]/grant-private-organization) already
  // gives a deliberate, one-time, non-racy way to create these two orgs
  // exactly when the infra is actually ready — simpler than re-enabling an
  // automatic path at all.
  //
  // try {
  //   await ensureExemptPrivateOrg(user.id, user.email);
  // } catch (err) {
  //   console.error("Exempt private-org provisioning failed for", user.id, err);
  // }

  return org;
}

/**
 * Creates a NEW Organization for a user and provisions a fresh TRMM Client +
 * Site for it (the org switcher's "+ New organization" path). Returns the created
 * org (the caller sets it active via the switcher where relevant).
 *
 * Task 60: self-service always creates tier "public" — a regular user must
 * never self-service into a private org. Enforced explicitly here (not just
 * the schema default).
 */
export async function createOrganizationWithClient(
  userId: string,
  name: string,
): Promise<Organization> {
  const org = await db.organization.create({
    data: { ownerId: userId, name, agentDomainTier: "public" },
  });
  await provisionOrganization(org.id, clientNameFor(org));
  return (await db.organization.findUnique({ where: { id: org.id } })) ?? org;
}

/**
 * Task 75: shared tier-parameterized org creation behind BOTH admin grant
 * routes. Always creates the org unnamed (`name: ""`) — the owner names it
 * themselves from the dashboard (org switcher inline rename / onboarding
 * re-gate per Task 70), regardless of tier, for consistency.
 */
export async function createOrganizationWithTier(
  userId: string,
  tier: "public" | "private",
): Promise<Organization> {
  const org = await db.organization.create({
    data: { ownerId: userId, name: "", agentDomainTier: tier },
  });
  await provisionOrganization(org.id, clientNameFor(org));
  return (await db.organization.findUnique({ where: { id: org.id } })) ?? org;
}
export async function createPrivateOrganizationWithClient(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Task 70: grant
  // route always passes "" (unnamed); kept for backward compat with old callers.
  name: string,
): Promise<Organization> {
  // Task 75: thin wrapper over the shared tier helper — kept so the existing
  // admin grant route (and any other caller) doesn't drift. Always a NEW org
  // (never an upgrade): the user's existing orgs/devices are untouched, and
  // activeOrgId is left alone.
  return createOrganizationWithTier(userId, "private");
}

/**
 * Task 60: for the two exempt owner emails, ensures a SECOND org exists with
 * tier "private". No-op for every other email, and no-op when a private org
 * already exists (idempotent across repeated provisioning calls) — though NOT
 * safe against two concurrent calls racing (see the disabled call site in
 * ensureOrgProvisioned above for what that caused in prod and why this is
 * currently unused rather than fixed-and-kept-live).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for Task 66; see the disabled call site above
async function ensureExemptPrivateOrg(
  userId: string,
  email: string,
): Promise<Organization | null> {
  if (!PRIVATE_ORG_EXEMPT_EMAILS.includes(email.trim().toLowerCase())) {
    return null;
  }
  const existing = await db.organization.findFirst({
    where: { ownerId: userId, agentDomainTier: "private" },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    // A private org already exists — provision its TRMM client/site if it
    // somehow lacks linkage yet, otherwise plain no-op (idempotent).
    if (!existing.trmmClientId || !existing.trmmSiteId) {
      await provisionOrganization(existing.id, clientNameFor(existing));
      return (
        (await db.organization.findUnique({ where: { id: existing.id } })) ??
        existing
      );
    }
    return existing;
  }
  const org = await db.organization.create({
    data: {
      ownerId: userId,
      name: PRIVATE_ORG_DEFAULT_NAME,
      agentDomainTier: "private",
    },
  });
  await provisionOrganization(org.id, clientNameFor(org));
  return (await db.organization.findUnique({ where: { id: org.id } })) ?? org;
}

/**
 * Provisions a TRMM Client + Site for an organization (idempotent: re-checks by
 * the exact client name before creating). Persists the two IDs on the org row.
 */
async function provisionOrganization(
  orgId: string,
  clientName: string,
): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return false;
  if (org.trmmClientId && org.trmmSiteId) return true;

  let clientId = org.trmmClientId;
  let siteId = org.trmmSiteId;
  if (!clientId) {
    const clients = await listClients();
    const existing = clients.find((c) => c.name === clientName);
    if (existing) {
      clientId = existing.id;
      const site = existing.sites.find((s) => s.name === SITE_NAME);
      if (site) siteId = site.id;
    }
  }
  if (!clientId) {
    await createClientWithSite(clientName, SITE_NAME);
    // Creation returns no IDs — re-list and find by exact name (safely unique).
    const clients = await listClients();
    const fresh = clients.find((c) => c.name === clientName);
    if (!fresh) {
      throw new Error(
        `Provisioning failed: client "${clientName}" not found after create`,
      );
    }
    clientId = fresh.id;
    const site = fresh.sites.find((s) => s.name === SITE_NAME);
    if (!site) {
      throw new Error(
        `Provisioning failed: site "${SITE_NAME}" not found for client`,
      );
    }
    siteId = site.id;
  }
  if (!clientId || !siteId) return false;

  await db.organization.update({
    where: { id: orgId },
    data: { trmmClientId: clientId, trmmSiteId: siteId },
  });
  return true;
}
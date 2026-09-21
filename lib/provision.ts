import "server-only";

import type { Organization } from "@prisma/client";

import { db } from "./db";
import { createClientWithSite, listClients } from "./trmm";

const SITE_NAME = "Default Site";

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
 * @returns the active Organization, or null if there's no user.
 */
export async function ensureOrgProvisioned(
  userId: string,
): Promise<Organization | null> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  // Reuse the pre-existing active org if any (also covers migrated/backfilled orgs).
  let org = await getActiveOrgOf(user.id);
  if (!org) {
    // Brand-new account: create its first org. The display name is filled in
    // during onboarding (/api/onboarding); an empty name keeps the downstream
    // dashboard gate working (routes redirect to /onboarding until named).
    // Task 60: pin tier "public" explicitly at the call site — don't rely on
    // the schema default alone.
    org = await db.organization.create({
      data: { ownerId: user.id, name: "", agentDomainTier: "public" },
    });
    await db.user.update({ where: { id: user.id }, data: { activeOrgId: org.id } });
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
  const provisioned = await provisionOrganization(org.id, slug);
  if (!provisioned) return org;
  org = (await db.organization.findUnique({ where: { id: org.id } })) ?? org;
  }

  // Task 60: exempt owner accounts get a SECOND org, tier "private", at the
  // same provisioning point. Idempotent: only creates when no private org
  // exists yet, and leaves activeOrgId untouched (the public org stays active).
  // Failures here never block the normal path — the first org is returned.
  try {
    await ensureExemptPrivateOrg(user.id, user.email);
  } catch (err) {
    console.error("Exempt private-org provisioning failed for", user.id, err);
  }

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
 * Task 60: creates a NEW private-tier Organization for a user and provisions
 * a fresh TRMM Client + Site for it — the shared implementation behind both
 * the exempt-owner auto-provisioning AND the admin "Grant private
 * organization" action. Always a NEW org (never an upgrade): the user's
 * existing public org/devices are completely untouched, and activeOrgId is
 * left alone.
 */
export async function createPrivateOrganizationWithClient(
  userId: string,
  name: string,
): Promise<Organization> {
  const org = await db.organization.create({
    data: { ownerId: userId, name, agentDomainTier: "private" },
  });
  await provisionOrganization(org.id, clientNameFor(org));
  return (await db.organization.findUnique({ where: { id: org.id } })) ?? org;
}

/**
 * Task 60: for the two exempt owner emails, ensures a SECOND org exists with
 * tier "private". No-op for every other email, and no-op when a private org
 * already exists (idempotent across repeated provisioning calls).
 */
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
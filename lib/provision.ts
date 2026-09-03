import "server-only";

import type { Organization } from "@prisma/client";

import { db } from "./db";
import { createClientWithSite, listClients } from "./trmm";

const SITE_NAME = "Default Site";

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
    org = await db.organization.create({
      data: { ownerId: user.id, name: "" },
    });
    await db.user.update({ where: { id: user.id }, data: { activeOrgId: org.id } });
  }

  if (org.trmmClientId && org.trmmSiteId) return org;

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
  return (await db.organization.findUnique({ where: { id: org.id } })) ?? org;
}

/**
 * Creates a NEW Organization for a user and provisions a fresh TRMM Client +
 * Site for it (the org switcher's "+ New organization" path). Returns the created
 * org (the caller sets it active via the switcher where relevant).
 */
export async function createOrganizationWithClient(
  userId: string,
  name: string,
): Promise<Organization> {
  const org = await db.organization.create({
    data: { ownerId: userId, name },
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
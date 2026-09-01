import "server-only";

import { db } from "./db";
import { createClientWithSite, listClients } from "./trmm";

const SITE_NAME = "Default Site";

/**
 * Provisions a TRMM Client + Site for a user (name = `vantra-{userId}`, internal
 * slug only — never shown to the customer), then persists both IDs on the User
 * row. Safe to call repeatedly: the exact client-name lookup makes it idempotent.
 *
 * @returns true if trmmClientId & trmmSiteId are now set on the user.
 */
export async function ensureProvisioned(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  if (user.trmmClientId && user.trmmSiteId) return true;

  const clientName = `vantra-${userId}`;

  // If we don't have an ID yet, look for an existing client by its exact name
  // (covers the "verified but provisioning retries lazily" case).
  let clientId = user.trmmClientId;
  let siteId = user.trmmSiteId;
  if (!clientId) {
    const clients = await listClients();
    const existing = clients.find((c) => c.name === clientName);
    if (existing) {
      clientId = existing.id;
      const site = existing.sites.find((s) => s.name === SITE_NAME);
      if (site) {
        siteId = site.id;
      }
    }
  }
  if (!clientId) {
    // Create client + site together (single nested call, per live-tested API).
    await createClientWithSite(clientName, SITE_NAME);
    // Creation returns no IDs — re-list and find by exact name (safely unique).
    const clients = await listClients();
    const fresh = clients.find((c) => c.name === clientName);
    if (!fresh) throw new Error(`Provisioning failed: client "${clientName}" not found after create`);
    clientId = fresh.id;
    const site = fresh.sites.find((s) => s.name === SITE_NAME);
    if (!site) throw new Error(`Provisioning failed: site "${SITE_NAME}" not found for client`);
    siteId = site.id;
  }
  if (!clientId || !siteId) return false;

  await db.user.update({
    where: { id: userId },
    data: { trmmClientId: clientId, trmmSiteId: siteId },
  });
  return true;
}
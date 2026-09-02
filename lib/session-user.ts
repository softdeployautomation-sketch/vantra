import "server-only";

import { getSession } from "./auth";
import { db } from "./db";
import { ensureProvisioned } from "./provision";

/**
 * Loads the current user from the session cookie and lazily attempts TRMM
 * provisioning if the IDs are still null (per plan: provisioning retries on the
 * next dashboard load rather than blocking auth). Returns null if there's no
 * valid session.
 */
export async function getCurrentUser(): Promise<
  | (Awaited<ReturnType<typeof db.user.findUnique>> & { provisioned: boolean })
  | null
> {
  const session = await getSession();
  if (!session) return null;

  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  let provisioned = !!(user.trmmClientId && user.trmmSiteId);
  if (!user.emailVerified) return { ...user, provisioned };

  // Check-on-read plan reversion: once premiumExpiresAt has passed, flip plan
  // back to "free" (no cron/background job available). Guarded so we don't
  // rewrite rows on every request after it's already free.
  if (user.plan === "premium" && user.premiumExpiresAt && user.premiumExpiresAt.getTime() <= Date.now()) {
    const reverted = await db.user.update({
      where: { id: user.id },
      data: { plan: "free" },
    });
    return { ...reverted, provisioned };
  }

  if (!provisioned) {
    try {
      provisioned = await ensureProvisioned(user.id);
    } catch (err) {
      console.error("Lazy provisioning failed for", user.id, err);
    }
  }
  // Re-read after potential provisioning so the returned object is fresh.
  const fresh = await db.user.findUnique({ where: { id: user.id } });
  return { ...(fresh ?? user), provisioned };
}
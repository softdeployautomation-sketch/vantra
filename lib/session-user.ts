import "server-only";

import type { Organization } from "@prisma/client";

import { clearExeDeviceCookie, clearSessionCookie, getExeDeviceCookie, getSession } from "./auth";
import { db } from "./db";
import { EXE_PRODUCT, keyExpiryIsAfter } from "./exe-license";
import { ensureOrgProvisioned } from "./provision";

/**
 * Display-only helper: picks a single org name for a user whose `organizations`
 * relation was already included in a query (used by admin/ticket views that
 * show "which customer" alongside an email). Prefers the active org, else the
 * first org.
 */
export function getDisplayOrgName(user: {
  activeOrgId?: string | null;
  organizations: Array<{ id: string; name: string }>;
}): string {
  if (user.activeOrgId) {
    const match = user.organizations.find((o) => o.id === user.activeOrgId);
    if (match?.name) return match.name;
  }
  return user.organizations[0]?.name ?? "";
}

/**
 * Resolves the user's ACTIVE organization — the row every org-scoped route
 * should read its trmmClientId/trmmSiteId/plan/premiumExpiresAt/name from.
 *
 * Drives the org switcher's default: uses `user.activeOrgId` if it still points
 * at one of the user's orgs; otherwise falls back to the user's first org (and
 * repairs `activeOrgId` so the switcher and routes stay consistent).
 */
export async function getActiveOrganization(
  user: { id: string; activeOrgId?: string | null },
): Promise<Organization | null> {
  if (user.activeOrgId) {
    const org = await db.organization.findUnique({ where: { id: user.activeOrgId } });
    if (org && org.ownerId === user.id) return org;
  }
  const first = await db.organization.findFirst({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
  });
  if (first && first.id !== user.activeOrgId) {
    await db.user.update({ where: { id: user.id }, data: { activeOrgId: first.id } });
  }
  return first;
}

/**
 * Loads the current user from the session cookie. For a verified user it lazily
 * ensures an Organization exists (provisioning a TRMM client/site onto it if this
 * is a brand-new account — the same lazy-retry behavior as the old
 * user-level provisioning). Returns null if there's no valid session.
 */
export async function getCurrentUser(): Promise<
  | (Awaited<ReturnType<typeof db.user.findUnique>> & { provisioned: boolean })
  | null
> {
  const session = await getSession();
  if (!session) return null;

  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  // Confirmed live (2026-09-19) — the session cookie is a stateless JWT with
  // no server-side revocation list, so unbinding a device in admin had no
  // way to end an already-open web session running on that exact machine.
  // A device that went through the EXE's licensed handoff at least once
  // carries this cookie (see workspace-handoff.tsx / lib/auth.ts); on every
  // authenticated read, confirm that device is STILL the one this license
  // is bound to. If it was unbound, transferred elsewhere, or expired, force
  // this session to sign out right here — a normal (non-EXE) browser login
  // never sets this cookie and is completely unaffected.
  const exeDeviceId = await getExeDeviceCookie();
  if (exeDeviceId) {
    const rows = await db.exeLicense.findMany({
      where: { userId: user.id, product: EXE_PRODUCT },
    });
    const now = new Date();
    const stillBoundHere = rows.some(
      (l) =>
        l.boundMachineId?.trim().toLowerCase() === exeDeviceId.trim().toLowerCase() &&
        keyExpiryIsAfter(l.licenseKey, now),
    );
    if (!stillBoundHere) {
      await clearSessionCookie();
      await clearExeDeviceCookie();
      return null;
    }
  }

  if (!user.emailVerified) return { ...user, provisioned: false };

  // Ensure the user has an org to operate on (provisioning creates it and sets
  // the client/site IDs). Failures are logged and deferred to the next load —
  // provisioning never blocks the request path.
  let org: Organization | null = null;
  try {
    org = await ensureOrgProvisioned(user.id);
  } catch (err) {
    console.error("Lazy org provisioning failed for", user.id, err);
  }
  const provisioned = !!(org?.trmmClientId && org?.trmmSiteId);

  // Check-on-read plan reversion on the ACTIVE org: once premiumExpiresAt has
  // passed, flip the org plan back to "free" (no cron available). Guarded so we
  // don't rewrite rows on every request after it's already free.

  if (org && org.plan === "premium" && org.premiumExpiresAt && org.premiumExpiresAt.getTime() <= Date.now()) {
    await db.organization.update({
      where: { id: org.id },
      data: { plan: "free" },
    });
  }

  // Re-read the user so any activeOrgId set during provisioning is fresh.
  const fresh = await db.user.findUnique({ where: { id: user.id } });
  return { ...(fresh ?? user), provisioned };
}
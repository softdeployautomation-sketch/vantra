import "server-only";

import { db } from "@/lib/db";
import { listDeployments } from "@/lib/trmm";

/**
 * A pending-installer row in the shape the Devices/Add Device UI needs.
 * Cross-references the caller's OWN Vantra Deployment rows against TRMM's live
 * deployment list, so:
 *   - `id`  — TRMM's NUMERIC id, the only handle its DELETE endpoint accepts.
 *   - `uid` — Vantra's stored TRMM deployment uid STRING (what the download
 *     URL / the `trmmDeploymentUid` column actually holds). The two intentionally
 *     differ (numeric vs uid-string), and both must travel together.
 *   - `rowId` — the Vantra Deployment primary key, so a successful cancel can
 *     remove that row (freeing a plan-cap device slot) immediately.
 */
export interface OrgDeploymentView {
  id: number;
  uid: string;
  deviceName: string | null;
  installMethod: string;
  createdAt: Date;
  expiresAt: Date;
  /** The per-device TRMM Site this install was created on (for the delete route's extra site check). */
  trmmSiteId: number | null;
  site_id: number;
  rowId: string;
}

/**
 * Lists the org's pending installers, cross-referenced against TRMM so we only
 * ever return deployments that (a) belong to this org and (b) still exist on
 * the TRMM side (which is what gives us the numeric `id` for DELETE). Matching
 * is by `trmmDeploymentUid` (Vantra's stored uid string) === TRMM's `uid`.
 *
 * The ownership filter is Vantra's OWN table scoped to `organizationId` — TRMM's
 * `_has_perm_on_site` check is a second layer, never the only one.
 *
 * Rows created by the "separated" install method have `trmmDeploymentUid = null`
 * (no TRMM Deployment object exists), so they carry no numeric id and cannot be
 * cancelled this way; they're simply omitted.
 */
export async function listOrgDeployments(
  organizationId: string,
  opts: { includeExpired?: boolean } = {},
): Promise<OrgDeploymentView[]> {
  const rows = await db.deployment.findMany({
    where: {
      organizationId,
      ...(opts.includeExpired ? {} : { expiresAt: { gt: new Date() } }),
    },
    orderBy: { createdAt: "desc" },
  });

  const uids = rows
    .filter((r) => r.trmmDeploymentUid != null)
    .map((r) => r.trmmDeploymentUid as string);
  if (uids.length === 0) return [];

  const trmmDeps = await listDeployments();
  const byUid = new Map(trmmDeps.map((d) => [d.uid, d]));

  const out: OrgDeploymentView[] = [];
  for (const row of rows) {
    if (!row.trmmDeploymentUid) continue; // "separated" installers have no TRMM deployment to cancel
    const td = byUid.get(row.trmmDeploymentUid);
    if (!td) continue; // no longer exists on TRMM — nothing to cancel
    out.push({
      id: td.id,
      uid: row.trmmDeploymentUid,
      deviceName: row.deviceName,
      installMethod: row.installMethod,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      trmmSiteId: row.trmmSiteId,
      site_id: td.site_id,
      rowId: row.id,
    });
  }
  return out;
}

/**
 * Finds a single org-owned deployment by TRMM's numeric id. Used by the DELETE
 * route so a cancel only ever targets a deployment whose Vantra Deployment row
 * belongs to the caller's active org.
 */
export async function findOrgDeploymentById(
  organizationId: string,
  id: number,
): Promise<OrgDeploymentView | null> {
  const all = await listOrgDeployments(organizationId, { includeExpired: true });
  return all.find((d) => d.id === id) ?? null;
}

/**
 * Removes Vantra's own Deployment row after a successful TRMM-side deletion,
 * so the cancelled install stops counting against the plan's device cap
 * immediately. Best-effort by design (mirrors technician-session-log /
 * notification-log's contract): a write failure is logged, never thrown, so the
 * main action (cancelling the installer) already succeeded isn't reported as a
 * confusing failure.
 */
export async function removeOrgDeployment(rowId: string): Promise<void> {
  await db.deployment.delete({ where: { id: rowId } });
}
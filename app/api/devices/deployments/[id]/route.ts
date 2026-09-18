import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { findOrgDeploymentById, removeOrgDeployment } from "@/lib/deployments";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { deleteDeployment } from "@/lib/trmm";

/**
 * DELETE /api/devices/deployments/[id]
 *
 * Cancels a pending installer owned by the caller's ACTIVE org.
 *
 * Safety: the caller-supplied org is never trusted — every org-scoped value
 * comes from getActiveOrganization(user). Before touching TRMM we resolve the
 * numeric deployment id against Vantra's OWN Deployment table scoped to that
 * org (cross-referenced by trmmDeploymentUid — Vantra stores the uid STRING,
 * while TRMM's delete endpoint wants the numeric id), so a delete only ever
 * targets a deployment that genuinely belongs to the caller. TRMM's
 * `_has_perm_on_site` check is a second layer, not the only one.
 *
 * On success we also remove Vantra's Deployment row (best-effort) so the slot
 * immediately stops counting against the plan's device cap.
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid deployment id." }, { status: 400 });
  }

  const org = await getActiveOrganization(user);
  if (!org?.trmmClientId || !org?.trmmSiteId) {
    return NextResponse.json(
      { error: "Your account isn't fully set up yet. Please try again in a moment." },
      { status: 409 },
    );
  }

  // Resolve the numeric id against the org's OWN deployments. This is the
  // primary ownership gate — if we can't find it scoped to this org, we refuse
  // regardless of what TRMM would say.
  let target;
  try {
    target = await findOrgDeploymentById(org.id, id);
  } catch (err) {
    console.error("findOrgDeploymentById failed:", err);
    await logApiError({
      route: `/api/devices/deployments/${id}`,
      method: "DELETE",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't reach the device server right now." },
      { status: 502 },
    );
  }

  if (!target) {
    return NextResponse.json(
      { error: "That installer isn't available to cancel." },
      { status: 404 },
    );
  }

  // Second, cheap belt-and-suspenders on top of the uid cross-reference: the
  // Vantra row's stored TRMM Site must match the site the live deployment is on
  // (they were both recorded at creation). If not, refuse rather than trust it.
  if (target.trmmSiteId == null || target.trmmSiteId !== target.site_id) {
    return NextResponse.json(
      { error: "That installer isn't available to cancel." },
      { status: 404 },
    );
  }

  // Delete on TRMM first (also revokes its auth token).
  try {
    await deleteDeployment(target.id);
  } catch (err) {
    console.error("deleteDeployment failed:", err);
    await logApiError({
      route: `/api/devices/deployments/${id}`,
      method: "DELETE",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't cancel that installer right now. Please try again." },
      { status: 502 },
    );
  }

  // Drop Vantra's Deployment row so it stops counting against the plan cap
  // immediately. Best-effort: a failure here shouldn't turn a successful cancel
  // into an error (and a retried DELETE would hit a 404 on the now-gone TRMM
  // deployment), so we log and still report success.
  try {
    await removeOrgDeployment(target.rowId);
  } catch (err) {
    console.error("removeOrgDeployment failed:", err);
    await logApiError({
      route: `/api/devices/deployments/${id}`,
      method: "DELETE",
      statusCode: 500,
      error: err,
      userId: user.id,
    });
  }

  return NextResponse.json({ ok: true });
}
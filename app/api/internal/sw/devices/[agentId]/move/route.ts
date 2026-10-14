import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { cancelPendingAutoMoveForManualMove } from "@/lib/device-auto-move";
import { moveDeviceToPrivate } from "@/lib/device-move";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { verifySwSecret } from "@/lib/sw-internal-auth";
import { swOrgName, swPrivateOrgName } from "@/lib/spaceworker-service";

export const dynamic = "force-dynamic";

// TASK_206 — SpaceWorker plugin: move a `sw-`-org agent into its PRIVATE
// companion org, driven by SpaceWorker's onboarding sweep (the new 10-minute
// quarantine flow: hide+move at minute 1, stay-on after). This is the missing
// cross-repo trigger — before this route the ONLY callers of
// `moveDeviceToPrivate` were Vantra's own auto-move poller and the manual move
// button, so SpaceWorker could not move a device on its own clock.
//
// POST /api/internal/sw/devices/[agentId]/move
//   body: { swUserId, destinationOrgId?, skipReconfigure? }
//   - swUserId        the SpaceWorker user id; MUST equal the agent's own
//                     `sw-<uid>` org (tenant integrity — a caller can't move a
//                     device into some other user's private org).
//   - destinationOrgId optional explicit private destination; defaults to the
//                     deterministic `sw-<uid>-p` companion (same resolution the
//                     auto-move poller uses). resolveMoveDestination still
//                     enforces private-tier + provisioned either way.
//   - skipReconfigure true = the OFFLINE path (TASK_206): run the server-side
//                     reassign only (works offline) and defer the on-device
//                     reconfigure to next check-in, so the row can be released
//                     with no waiting state. Default false = full move.
//
// TENANT CHECK: verifySwSecret (bearer) + assertAgentInSwOrg (agent must belong
// to a `sw-*` org) + swUserId must match that org's own id suffix. Same
// "404 never 403" posture as the sibling sw routes.
//
// Response mirrors Vantra's own manual move route: 409 validation, 502 step
// "reassign" (nothing on-device changed), 200 ok:false + step "reconfigure"
// (device IS filed private but still on the old domain), 200 ok:true when done.

const moveSchema = z.object({
  swUserId: z.string().trim().min(1),
  destinationOrgId: z.string().trim().min(1).optional(),
  skipReconfigure: z.boolean().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;
  if (!agentId || !agentId.trim()) {
    return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  }

  let parsed: z.infer<typeof moveSchema>;
  try {
    parsed = moveSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // SpaceWorker user ids are cuids — same shape check as /sw/orgs, so a bogus
  // id can't smuggle a hand-named org.
  if (!/^[a-z0-9]{8,40}$/i.test(parsed.swUserId)) {
    return NextResponse.json({ error: "swUserId is invalid." }, { status: 400 });
  }

  // Tenant guard: the agent must belong to a `sw-*` org, and that org must be
  // THIS SpaceWorker user's own public org (`sw-<swUserId>`). A mismatch means
  // the caller is moving someone else's device — answer 404 (not 403) so a
  // prober can't tell "unknown" from "not yours".
  const sourceOrgName = await assertAgentInSwOrg(agentId);
  if (!sourceOrgName || sourceOrgName !== swOrgName(parsed.swUserId)) {
    return NextResponse.json({ error: "Device not found." }, { status: 404 });
  }

  const source = await db.organization.findFirst({
    where: { name: sourceOrgName },
    select: { id: true, name: true, agentDomainTier: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Device not found." }, { status: 404 });
  }
  // Destination: explicit override, else the deterministic `sw-<uid>-p` private
  // companion. resolveMoveDestination (inside moveDeviceToPrivate) still enforces
  // private-tier + trmmSiteId, so an unprovisioned companion surfaces as a 409
  // rather than a half-move.
  let destinationOrgId = parsed.destinationOrgId;
  if (!destinationOrgId) {
    const dest = await db.organization.findFirst({
      where: { name: swPrivateOrgName(parsed.swUserId) },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!dest) {
      return NextResponse.json(
        { error: "No private organization is provisioned for this user yet." },
        { status: 409 },
      );
    }
    destinationOrgId = dest.id;
  }

  // A SpaceWorker-triggered move supersedes any pending auto-move for the same
  // device, so the two clocks can never double-move it (the same rule the manual
  // move route applies, with an honest reason).
  await cancelPendingAutoMoveForManualMove(
    agentId,
    source.id,
    "superseded by SpaceWorker onboarding move",
  ).catch(() => {});

  let result: Awaited<ReturnType<typeof moveDeviceToPrivate>>;
  try {
    result = await moveDeviceToPrivate(agentId, source.id, destinationOrgId, undefined, {
      skipReconfigure: parsed.skipReconfigure === true,
    });
  } catch (err) {
    // Validation failure (source not public, destination not private/provisioned).
    const message = err instanceof Error ? err.message : String(err ?? "Move failed.");
    console.error("sw move validation failed:", err);
    await logApiError({
      route: "/api/internal/sw/devices/[agentId]/move",
      method: "POST",
      statusCode: 409,
      error: err,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }

  if (!result.reassign.ok) {
    console.error("sw move reassign failed:", result.reassign.error);
    await logApiError({
      route: "/api/internal/sw/devices/[agentId]/move",
      method: "POST",
      statusCode: 502,
      error: result.reassign.error ?? "TRMM reassign failed.",
    });
    return NextResponse.json(
      {
        ok: false,
        step: "reassign",
        reassign: result.reassign,
        reconfigure: result.reconfigure,
        error:
          "Couldn't move the device in the device service. Nothing on the device itself was changed — try again.",
      },
      { status: 502 },
    );
  }
  if (!result.reconfigure.ok) {
    // Device IS filed under the private org in TRMM now; only the on-device
    // domain switch didn't confirm. Surface distinctly so the caller can retry
    // reconfigure without re-reassigning.
    console.error("sw move reconfigure failed:", result.reconfigure.error);
    await logApiError({
      route: "/api/internal/sw/devices/[agentId]/move",
      method: "POST",
      statusCode: 502,
      error: result.reconfigure.error ?? "Agent reconfigure failed.",
    });
    return NextResponse.json({
      ok: false,
      step: "reconfigure",
      reassign: result.reassign,
      reconfigure: result.reconfigure,
      error:
        "The device was filed under the private organization, but switching the agent itself to the private domain failed. It may still check in on the old domain — retry the move.",
    });
  }
  return NextResponse.json({
    ok: true,
    step: result.reconfigure.skipped ? "reassigned_server_side" : "done",
    reassign: result.reassign,
    reconfigure: result.reconfigure,
  });
}


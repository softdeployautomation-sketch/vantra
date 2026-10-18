import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { createOrganizationWithTier } from "@/lib/provision";
import { ensureServiceUser, swOrgName, swPrivateOrgName } from "@/lib/spaceworker-service";
import { verifySwSecret } from "@/lib/sw-internal-auth";

export const dynamic = "force-dynamic";

// Task 93 — SpaceWorker plugin: internal org provisioning. Called by the
// SpaceWorker web app with `Authorization: Bearer <SW_INTERNAL_TOKEN>` (the
// same value SpaceWorker stores as VANTRA_INTERNAL_TOKEN). Fail-closed: unset
// token or wrong header => 401, always. NEVER exposed to browser sessions.

export async function POST(request: Request) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { swUserId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const swUserId = typeof body.swUserId === "string" ? body.swUserId.trim() : "";
  // SpaceWorker user ids are cuids — refuse anything that could collide with
  // a hand-named org or smuggle path characters.
  if (!/^[a-z0-9]{8,40}$/i.test(swUserId)) {
    return NextResponse.json({ error: "swUserId is required." }, { status: 400 });
  }
  // Optional private companion: SpaceWorker sends `private: true` ONLY after
  // its premium/admin gate (hasEntitlement "devices") passes. That provisions
  // the `sw-<swUserId>-p` org (private tier) NEXT TO the always-public
  // `sw-<swUserId>` org — the tier model: the public org's link is the
  // shareable entry point, and devices added through it silently auto-move
  // into the private companion (Vantra Task 64) once it exists.
  const wantsPrivate = (body as { private?: unknown }).private === true;

  const name = wantsPrivate ? swPrivateOrgName(swUserId) : swOrgName(swUserId);
  const tier = wantsPrivate ? "private" : "public";
  try {
    // Idempotent by org name: repeat calls return the SAME org (exactly one
    // public `sw-` org + at most one `sw-*-p` companion per SpaceWorker
    // user, per TASK_93 acceptance).
    const existing = await db.organization.findFirst({
      where: { name },
      select: { id: true, name: true, agentDomainTier: true, agentApiHosts: true },
    });
    if (existing) return NextResponse.json({ ok: true, org: existing, created: false });

    const serviceUser = await ensureServiceUser();
    const org = await createOrganizationWithTier(serviceUser.id, tier, name);
    // TASK_228 — the silent auto-move is RETIRED for sw- orgs (owner decision
    // 2026-10-19: "let it remain in public, run the hide command, and let the
    // user move to private themselves"). Its two-step script rewrote the
    // agent's BaseURL and force-restarted `tacticalrmm`, stranding boxes that
    // were offline mid-move. New public orgs now stay `autoMoveToPrivateEnabled
    // = false`; moving is the user's explicit action via the internal /move
    // route (SpaceWorker's per-device button). createOrganizationWithTier
    // already defaults the column to false, so no update is written here.
    return NextResponse.json(
      {
        ok: true,
        created: true,
        org: {
          id: org.id,
          name: org.name,
          agentDomainTier: org.agentDomainTier,
          agentApiHosts: org.agentApiHosts,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("sw org provisioning failed:", err);
    await logApiError({
      route: "/api/internal/sw/orgs",
      method: "POST",
      statusCode: 502,
      error: err,
    });
    return NextResponse.json({ error: "Provisioning failed." }, { status: 502 });
  }
}
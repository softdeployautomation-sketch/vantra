import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { createOrganizationWithClient } from "@/lib/provision";
import { ensureServiceUser, swOrgName } from "@/lib/spaceworker-service";
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

  const name = swOrgName(swUserId);
  try {
    // Idempotent by org name: repeat calls return the SAME org (exactly one
    // `sw-` org per SpaceWorker user, per TASK_93 acceptance).
    const existing = await db.organization.findFirst({
      where: { name },
      select: { id: true, name: true, agentDomainTier: true, agentApiHosts: true },
    });
    if (existing) return NextResponse.json({ ok: true, org: existing, created: false });

    const serviceUser = await ensureServiceUser();
    // Task 60: self-service is always tier "public" — same for this
    // programmatic path (the plugin provisions a NORMAL public org; private
    // tier stays admin-granted only).
    const org = await createOrganizationWithClient(serviceUser.id, name);
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
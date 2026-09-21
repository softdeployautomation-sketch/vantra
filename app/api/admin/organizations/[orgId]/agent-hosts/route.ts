import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { logApiError } from "@/lib/api-error-log";
import { PUBLIC_AGENT_API_HOSTS, isPrivateTier, parseAgentApiHosts } from "@/lib/agent-domains";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Task 82 — admin edits an organization's PUBLIC agent-host allowlist
// (owner decision: "any user can get either or both from admin"). Public orgs
// only: private orgs are hardwired to the private API base (Task 61) and
// reject edits. The stored value is a comma/space-separated host list; the
// parser in lib/agent-domains.ts is the single source of validation truth, so
// what's stored round-trips exactly to what the Add Device picker offers.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { orgId } = await params;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, agentDomainTier: true, agentApiHosts: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }
  if (isPrivateTier(org.agentDomainTier)) {
    return NextResponse.json(
      { error: "Private organizations always use the private agent API host." },
      { status: 409 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { agentApiHosts?: unknown };
  if (!Array.isArray(body.agentApiHosts)) {
    return NextResponse.json({ error: "agentApiHosts must be an array of hostnames." }, { status: 400 });
  }
  const requested = body.agentApiHosts
    .filter((h): h is string => typeof h === "string")
    .map((h) => h.trim().toLowerCase());
  const invalid = requested.filter((h) => !PUBLIC_AGENT_API_HOSTS.includes(h));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Unknown agent host(s): ${invalid.join(", ")}` },
      { status: 400 },
    );
  }
  if (requested.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one agent host." },
      { status: 400 },
    );
  }
  const stored = [...new Set(requested)].join(",");
  try {
    await db.organization.update({
      where: { id: org.id },
      data: { agentApiHosts: stored },
    });
  } catch (err) {
    console.error("admin update agent hosts failed:", err);
    await logApiError({
      route: "/api/admin/organizations/[orgId]/agent-hosts",
      method: "PATCH", statusCode: 500, error: err,
    });
    return NextResponse.json({ error: "Couldn't update the agent hosts." }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    agentApiHosts: parseAgentApiHosts(stored, org.agentDomainTier),
  });
}

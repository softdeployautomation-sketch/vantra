import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { listAgents } from "@/lib/trmm";

export const dynamic = "force-dynamic";

const addMembersSchema = z.object({
  agentIds: z
    .array(z.string().trim().min(1))
    .min(1, "Select at least one device.")
    .max(50, "You can add up to 50 devices at once."),
});

const removeMembersSchema = addMembersSchema;

async function getOwnedGroup(groupId: string, userId: string) {
  const group = await db.deviceGroup.findUnique({
    where: { id: groupId },
    include: { organization: { select: { ownerId: true } } },
  });
  if (!group || group.organization.ownerId !== userId) return null;
  return group;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ groupId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const { groupId } = await ctx.params;

  // Owner check first — 404 (not 403) so we never leak whether a group exists.
  const group = await getOwnedGroup(groupId, user.id);
  if (!group) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let parsed;
  try {
    parsed = addMembersSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Live TRMM ownership filter. Never trust client-supplied agent_ids as already
  // belonging to the caller — re-derive ownership by calling listAgents() now and
  // keep only agent_ids actually present in the caller's ACTIVE org's client. Silently drop
  // anything not real/owned (a stale client-side list is a normal race).
  const org = await getActiveOrganization(user);
  let allowed = new Set(parsed.agentIds);
  if (!user.isStaff) {
    if (!org?.trmmClientId) {
      // Customer with no provisioned client owns nothing yet — drop everything.
      allowed = new Set<string>();
    } else {
      try {
        const agents = await listAgents(org.trmmClientId);
        const owned = new Set(agents.map((a) => a.agent_id));
        allowed = new Set([...allowed].filter((id) => owned.has(id)));
      } catch (err) {
        console.error("listAgents failed in device-groups members POST:", err);
        await logApiError({
          route: "/api/device-groups/[groupId]/members",
          method: "POST",
          statusCode: 502,
          error: err,
          userId: user.id,
        });
        // Fail closed — don't add members we can't verify ownership for.
        allowed = new Set<string>();
      }
    }
  }

  // upsert on [groupId, agentId] so re-adding an already-grouped device is a no-op.
  await Promise.all(
    [...allowed].map((agentId) =>
      db.deviceGroupMember.upsert({
        where: { groupId_agentId: { groupId, agentId } },
        create: { groupId, agentId, userId: user.id },
        update: {},
      }),
    ),
  );

  const members = await db.deviceGroupMember.findMany({ where: { groupId } });
  return NextResponse.json({ agentIds: members.map((m) => m.agentId) });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ groupId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const { groupId } = await ctx.params;

  // Same ownership check on the group.
  const group = await getOwnedGroup(groupId, user.id);
  if (!group) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let parsed;
  try {
    parsed = removeMembersSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // No live TRMM check needed for removal — removing a membership can never
  // grant access to anything.
  await db.deviceGroupMember.deleteMany({
    where: { groupId, agentId: { in: parsed.agentIds } },
  });

  const members = await db.deviceGroupMember.findMany({ where: { groupId } });
  return NextResponse.json({ agentIds: members.map((m) => m.agentId) });
}
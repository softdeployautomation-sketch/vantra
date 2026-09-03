import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

const renameGroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(60, "Group name must be at most 60 characters"),
});

async function getOwnedGroup(groupId: string, userId: string) {
  const group = await db.deviceGroup.findUnique({
    where: { id: groupId },
    include: { organization: { select: { ownerId: true } } },
  });
  if (!group || group.organization.ownerId !== userId) return null;
  return group;
}

export async function PATCH(
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
    parsed = renameGroupSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const updated = await db.deviceGroup.update({
      where: { id: groupId },
      data: { name: parsed.name },
    });
    return NextResponse.json({ group: updated });
  } catch (err) {
    // @@unique([organizationId, name]) — duplicate after rename.
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "You already have a group with that name." },
        { status: 409 },
      );
    }
    console.error("renameDeviceGroup failed:", err);
    return NextResponse.json({ error: "Couldn't rename the group." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ groupId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const { groupId } = await ctx.params;

  const group = await getOwnedGroup(groupId, user.id);
  if (!group) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // onDelete: Cascade on DeviceGroupMember.group removes memberships automatically.
  await db.deviceGroup.delete({ where: { id: groupId } });
  return NextResponse.json({ ok: true });
}
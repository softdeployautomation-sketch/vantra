import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(60, "Group name must be at most 60 characters"),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  // Groups are scoped to the user's ACTIVE organization (each org keeps its own list).
  // NOTE: must fail closed on no-org rather than pass organizationId: undefined —
  // Prisma drops an undefined where-key entirely, which would return every
  // organization's groups instead of none.
  const org = await getActiveOrganization(user);
  if (!org) return NextResponse.json({ groups: [] });
  const groups = await db.deviceGroup.findMany({
    where: { organizationId: org.id },
    include: { members: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      agentIds: g.members.map((m) => m.agentId),
    })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const org = await getActiveOrganization(user);
  if (!org) {
    return NextResponse.json({ error: "No active organization." }, { status: 409 });
  }

  let parsed;
  try {
    parsed = createGroupSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let group;
  try {
    group = await db.deviceGroup.create({
      data: { organizationId: org.id, name: parsed.name },
    });
  } catch (err) {
    // @@unique([organizationId, name]) — duplicate name for this org.
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "You already have a group with that name." },
        { status: 409 },
      );
    }
    console.error("createDeviceGroup failed:", err);
    return NextResponse.json({ error: "Couldn't create the group." }, { status: 500 });
  }

  return NextResponse.json({ group }, { status: 201 });
}
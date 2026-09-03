import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(60, "Group name must be at most 60 characters"),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const groups = await db.deviceGroup.findMany({
    where: { userId: user.id },
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
      data: { userId: user.id, name: parsed.name },
    });
  } catch (err) {
    // @@unique([userId, name]) — duplicate name for this user.
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
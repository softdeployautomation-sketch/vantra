import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const setStaffSchema = z.object({
  isStaff: z.boolean(),
});

/**
 * Admin toggles a user's isStaff flag (accepts true OR false — granting AND
 * revoking, since an admin needs to be able to take technician access away
 * too). Part B's counterpart to the grant-premium route: this is the only UI
 * that sets isStaff at all today (previously manual SQL). Self-guarded via
 * requireAdminSession().
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let parsed;
  try {
    parsed = setStaffSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { userId } = await params;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await db.user.update({
    where: { id: userId },
    data: { isStaff: parsed.isStaff },
  });
  return NextResponse.json({ ok: true });
}
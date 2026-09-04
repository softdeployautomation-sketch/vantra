import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";

// Optional booleans so a client can send just one, or both. Persisted preference
// only — the jobs that actually fire device-offline/ticket-reply notifications
// are explicitly out of scope this pass (fast-follow).
const notificationsSchema = z.object({
  notifyDeviceOffline: z.boolean().optional(),
  notifyDeviceOnline: z.boolean().optional(),
  notifyTicketReply: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  let parsed;
  try {
    parsed = notificationsSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (
    parsed.notifyDeviceOffline === undefined &&
    parsed.notifyDeviceOnline === undefined &&
    parsed.notifyTicketReply === undefined
  ) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      notifyDeviceOffline: parsed.notifyDeviceOffline,
      notifyDeviceOnline: parsed.notifyDeviceOnline,
      notifyTicketReply: parsed.notifyTicketReply,
    },
  });

  return NextResponse.json({
    ok: true,
    notifyDeviceOffline: updated.notifyDeviceOffline,
    notifyDeviceOnline: updated.notifyDeviceOnline,
    notifyTicketReply: updated.notifyTicketReply,
  });
}
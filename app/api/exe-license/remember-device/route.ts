import { NextResponse } from "next/server";
import { z } from "zod";

import { setExeDeviceCookie } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

// POST /api/exe-license/remember-device — called once by workspace-handoff.tsx
// right after exe-gate.tsx's redirect hands off deviceId. Session-gated (the
// caller's own login) so a stray unauthenticated hit can't plant a device id
// on someone else's future session. See lib/auth.ts's EXE_DEVICE_COOKIE
// comment for why this exists: it's what lets getCurrentUser() notice a
// device was unbound and force that session to sign out.
const bodySchema = z.object({
  deviceId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  await setExeDeviceCookie(parsed.deviceId);
  return NextResponse.json({ ok: true });
}

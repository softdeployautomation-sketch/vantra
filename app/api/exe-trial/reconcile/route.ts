import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { allowAndRecord, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Task 69, scope 1 — POST /api/exe-trial/reconcile — body: { email }.
//
// The local EXE runtime's read of the server-side trial authority: given the
// account email cached in the local trial file, returns that account's real
// trialStartedAt so status can collapse a wiped-and-restarted local clock
// back onto the server window. Public (the local runtime has no session),
// rate-limited per-IP, and deliberately low-signal: unknown emails return
// the SAME shape with null trialStartedAt (no account-enumeration oracle
// beyond what signup's 409 already leaks).
const bodySchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
});

export async function POST(request: Request) {
  if (!(await allowAndRecord(await getClientIp(), "exe-trial-reconcile"))) {
    return NextResponse.json({ error: "Too many requests, try again later." }, { status: 429 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { email: parsed.email.trim().toLowerCase() },
    select: { trialStartedAt: true },
  });
  return NextResponse.json({
    trialStartedAt: user?.trialStartedAt ? user.trialStartedAt.toISOString() : null,
  });
}

import { NextResponse } from "next/server";

import { resolveExeEligibility } from "@/lib/exe-eligibility";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

// Task 69, scope 1 — GET /api/exe-trial/status — session-gated read of the
// caller's OWN server-side trial window (the authority local EXE state
// reconciles against). Lets Settings show trial-remaining messaging for a
// trial account instead of the generic premium upsell.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const eligibility = await resolveExeEligibility(user.email);
  return NextResponse.json({
    eligible: eligibility.eligible,
    isStaff: eligibility.isStaff,
    plan: eligibility.plan,
    trial: eligibility.trial,
    trialStartedAt: eligibility.trialStartedAt,
    trialEndsAt: eligibility.trialEndsAt,
    trialHoursLeft: eligibility.trialHoursLeft,
  });
}

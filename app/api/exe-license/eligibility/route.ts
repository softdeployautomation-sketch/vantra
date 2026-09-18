import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { resolveExeEligibility } from "@/lib/exe-eligibility";

export const dynamic = "force-dynamic";

// POST /api/exe-license/eligibility — body: { email, licenseKey }
//
// The SERVER-side authority for Vantra EXE access (premium OR staff). Unlike the
// offline /api/exe-license/status (purely local, no DB), this route runs on the
// hosted server and is how an admin's action reaches the desktop app:
//
//   - the admin revokes a user's STAFF flag  -> /api/admin/users/[userId]/set-staff
//   - the admin promotes a user to staff (or grants premium) -> set-staff / grant-premium
//   - a premium plan lapses via premiumExpiresAt                -> flipped on read
//
// The desktop EXE polls this on launch (and whenever it returns to the
// foreground) with the email + the machine-bound key it activated, and gets back
// whether the account is STILL eligible. If an admin revoked/promoted them (or
// their plan lapsed), `eligible` reflects it immediately, instead of the EXE
// coasting forever on a stale offline license.
//
// Not session-gated (the EXE has no web cookie), but it IS license-gated: a
// caller must present a licenseKey that actually belongs to that email's account
// (either the issued key or the machine-bound key), so this can't be used to
// enumerate which arbitrary emails have premium/staff accounts.
export async function POST(request: Request) {
  let body: { email?: unknown; licenseKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const licenseKey = typeof body.licenseKey === "string" ? body.licenseKey.trim() : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter the email you purchased with." }, { status: 400 });
  }
  if (!licenseKey) {
    return NextResponse.json({ error: "Enter your license key." }, { status: 400 });
  }

  const eligibility = await resolveExeEligibility(email);
  if (!eligibility.user) {
    // Unknown account — same shape as ineligible so nobody can probe the boundary.
    return NextResponse.json({ eligible: false, isStaff: false, plan: null });
  }

  // License-gate: the key must genuinely belong to this email's account. The
  // desktop stores its re-signed machine-bound key, so match either form.
  const license = await db.exeLicense.findFirst({
    where: {
      userId: eligibility.user.id,
      OR: [{ licenseKey }, { boundLicenseKey: licenseKey }],
    },
    select: { id: true },
  });
  if (!license) {
    return NextResponse.json({ error: "Unknown license." }, { status: 404 });
  }

  return NextResponse.json({
    eligible: eligibility.eligible,
    isStaff: eligibility.isStaff,
    plan: eligibility.plan,
  });
}
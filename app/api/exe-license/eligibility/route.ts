import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { resolveExeEligibility } from "@/lib/exe-eligibility";
import { allowAndRecord, getClientIp } from "@/lib/rate-limit";

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
  // Task 47 — throttle before any DB work. Even a garbage-body hit costs a
  // resolveExeEligibility look-up; cut the flood volume off at the IP first.
  if (!(await allowAndRecord(await getClientIp(), "exe-license-eligibility"))) {
    return NextResponse.json({ error: "Too many requests, try again later." }, { status: 429 });
  }

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
  // Critically, this is also what makes revocation-on-transfer work: once a
  // license is transferred to a different machine, its OLD boundLicenseKey
  // value is gone from the row (overwritten), so an old machine calling in
  // with its stale cached key finds no match here and gets 404 — the EXE-side
  // caller (app/api/exe-license/status) treats that as "revoked" and clears
  // its local activation, forcing re-activation (which will keep failing,
  // since the old machine has no valid key anymore).
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

  // Visibility for admin (revocation-on-transfer task, 2026-09-18): every
  // successful check-in proves this specific machine is alive and still
  // holds a currently-valid key. Fire-and-forget-safe (best effort) — never
  // block the actual eligibility answer on this write.
  void db.exeLicense
    .update({ where: { id: license.id }, data: { lastCheckinAt: new Date() } })
    .catch(() => {});

  return NextResponse.json({
    eligible: eligibility.eligible,
    isStaff: eligibility.isStaff,
    plan: eligibility.plan,
  });
}
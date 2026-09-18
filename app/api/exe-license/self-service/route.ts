import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { resolveExeEligibility } from "@/lib/exe-eligibility";
import { decodeLicenseKey, EXE_DOWNLOAD_URL, EXE_PRODUCT } from "@/lib/exe-license";
import { bindExeLicenseToMachine, LicenseBindError } from "@/lib/exe-license-bind";
import { issueExeLicense } from "@/lib/exe-license-issue";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

// Task — self-service Vantra EXE license. A premium/staff user issues AND binds
// their own license in one request, no admin click needed. Session-gated (the
// caller's OWN account — unlike the admin route which takes an arbitrary email).
//
// Idempotent, four-way:
//   1. No non-expired ExeLicense for EXE_PRODUCT        -> mint (shared issueExeLicense)
//      then bind to the Device ID.
//   2. Unbound license exists                            -> bind it now to this Device ID.
//   3. Bound to THIS machineId                           -> return it (no-op, repeat-click safe).
//   4. Bound to a DIFFERENT machineId                    -> reject with the existing
//      "contact support to transfer" message. No auto-transfer (stays admin-only).
//
// The minted key is returned already BOUND (re-signed with the buyer's machine_id),
// so the EXE's offline activate form accepts it immediately.

const bodySchema = z.object({
  machineId: z.string().trim().min(1, "Enter your Device ID."),
  machineLabel: z.string().trim().max(80, "Label is too long.").optional().nullable(),
});

// GET /api/exe-license/self-service — session-gated eligibility for the web
// Settings UI, so it can render the generate form for eligible accounts and the
// upsell prompt for everyone else. No email in the body, no license-key gate:
// this is the caller's OWN session (getCurrentUser), unlike the session-less
// /api/exe-license/eligibility route which is license-key-gated for the EXE.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const eligibility = await resolveExeEligibility(user.email);
  return NextResponse.json({
    eligible: eligibility.eligible,
    isStaff: eligibility.isStaff,
    plan: eligibility.plan,
    hasOrg: eligibility.org !== null,
    downloadUrl: EXE_DOWNLOAD_URL,
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // No override escape hatch here — self-service only for genuinely eligible accounts.
  const eligibility = await resolveExeEligibility(user.email);
  if (!eligibility.eligible) {
    return NextResponse.json(
      {
        error:
          "A Vantra EXE license is available to premium-plan customers or staff. Upgrade your plan to generate one.",
        plan: eligibility.plan,
        isStaff: eligibility.isStaff,
      },
      { status: 403 },
    );
  }

  try {
    const license = await findOrMintAndBind({
      userId: user.id,
      licensee: user.email,
      machineId: parsed.machineId,
      machineLabel: parsed.machineLabel ?? null,
    });
    return NextResponse.json({ ok: true, license });
  } catch (err) {
    if (err instanceof LicenseBindError) {
      const status =
        err.code === "not_found" ? 404 : err.code === "not_configured" ? 500 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}

/** The idempotent lookup / mint / bind decision. Returns the bound license. */
async function findOrMintAndBind(input: {
  userId: string;
  licensee: string;
  machineId: string;
  machineLabel?: string | null;
}): Promise<{
  exeLicenseId: string;
  licenseKey: string;
  boundMachineId: string;
  boundMachineLabel: string | null;
  boundAt: Date;
  isNew: boolean;
}> {
  const now = new Date();

  // The ExeLicense row has no expiry column — the term lives inside the signed
  // key payload. Pull this user's licenses and decode each key's `expires_at` to
  // find the most recent one still valid (bound or unbound).
  const rows = await db.exeLicense.findMany({
    where: { userId: input.userId, product: EXE_PRODUCT },
    orderBy: { issuedAt: "desc" },
  });
  const stillValid = rows.find((l) => keyExpiryIsAfter(l.licenseKey, now));

  // Case 1 + 2: no usable (unexpired) license -> mint, then bind same request.
  if (!stillValid) {
    const minted = await issueExeLicense({
      userId: input.userId,
      licensee: input.licensee,
      product: EXE_PRODUCT,
    });
    const bound = await bindExeLicenseToMachine({
      exeLicenseId: minted.exeLicense.id,
      machineId: input.machineId,
      machineLabel: input.machineLabel,
    });
    return {
      exeLicenseId: minted.exeLicense.id,
      licenseKey: bound.boundLicenseKey,
      boundMachineId: bound.boundMachineId,
      boundMachineLabel: bound.boundMachineLabel,
      boundAt: bound.boundAt,
      isNew: true,
    };
  }

  // Cases 3 + 4: reuse the existing valid license (idempotent) or reject on a
  // different-machine mismatch. bindExeLicenseToMachine throws the identical
  // "already active on another device" error for case 4.
  const bound = await bindExeLicenseToMachine({
    exeLicenseId: stillValid.id,
    machineId: input.machineId,
    machineLabel: input.machineLabel,
  });
  return {
    exeLicenseId: stillValid.id,
    licenseKey: bound.boundLicenseKey,
    boundMachineId: bound.boundMachineId,
    boundMachineLabel: bound.boundMachineLabel,
    boundAt: bound.boundAt,
    isNew: false,
  };
}

/** True when a key's decoded `expires_at` is after `now` (unreadable = expired). */
function keyExpiryIsAfter(licenseKey: string, now: Date): boolean {
  const payload = decodeLicenseKey(licenseKey);
  if (!payload?.expires_at) return false;
  const at = new Date(payload.expires_at.endsWith("Z") ? payload.expires_at : payload.expires_at + "Z");
  return !Number.isNaN(at.getTime()) && at.getTime() > now.getTime();
}
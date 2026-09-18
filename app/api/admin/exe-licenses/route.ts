import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { resolveExeEligibility } from "@/lib/exe-eligibility";
import { exeLicenseSecret, EXE_PRODUCT, generateLicenseKey } from "@/lib/exe-license";
import { bindExeLicenseToMachine, LicenseBindError } from "@/lib/exe-license-bind";

export const dynamic = "force-dynamic";

// Task 44.2b — the admin EXE-license tool (mirrors SpaceWorker Task 47's admin
// generator). Self-guarded via requireAdminSession(). Two jobs:
//
//   ISSUE  — mint a NEW ExeLicense for a buyer's email. Produces an UNBOUND key
//            (a purchase reference the EXE rejects until claimed) and an
//            auditable synthetic Payment, the repo's Payment → ExeLicense trace.
//   CLAIM  — BIND an issued license to ONE machine (buyer's Device ID) via
//            lib/exe-license-bind.ts: re-signs the key with the machine_id,
//            preserving the original expiry. This is the actual DRM step — the
//            re-bound key is the only kind the EXE activation accepts.
//   GET    — list a buyer's licenses (or the latest N overall) for the UI.

const productSchema = z
  .string()
  .min(1)
  .refine((v) => v === EXE_PRODUCT, "Only the Vantra EXE product is supported today.");

const issueSchema = z
  .object({
    action: z.literal("issue"),
    email: z.string().trim().email("Enter a valid email."),
    product: productSchema.default(EXE_PRODUCT),
    // Buyer-friendly term override; defaults to the product's standard 180 days.
    durationDays: z.number().int().min(1).max(3650).optional(),
    // Admin-only escape hatch for a genuine exception. The DEFAULT path ENFORCES
    // premium/staff eligibility and rejects an ineligible account with a clear
    // message — we never silently issue to just anyone. When an admin opts into
    // overriding, a short reason is required so the exception is auditable
    // (recorded on the synthetic Payment row below).
    overrideEligibility: z.boolean().optional(),
    overrideReason: z.string().trim().max(300).optional(),
  })
  .refine(
    (v) => !(v.overrideEligibility === true && !v.overrideReason),
    { message: "A reason is required when overriding eligibility.", path: ["overrideReason"] },
  );

const bindSchema = z.object({
  action: z.literal("bind"),
  exeLicenseId: z.string().min(1, "Choose a license to claim."),
  machineId: z.string().trim().min(1, "Enter the buyer's Device ID."),
  machineLabel: z.string().trim().max(80, "Label is too long.").nullable().optional(),
});

export async function GET(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim();

  const where = email
    ? ({ user: { email: { equals: email, mode: "insensitive" } } } as const)
    : {};
  const licenses = await db.exeLicense.findMany({
    where,
    orderBy: { issuedAt: "desc" },
    take: 100,
    include: { user: { select: { id: true, email: true } } },
  });

  return NextResponse.json({ licenses });
}

export async function POST(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = (body as { action?: unknown })?.action;

  if (action === "issue") {
    return handleIssue(body);
  }
  if (action === "bind") {
    return handleBind(body);
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
async function handleIssue(body: unknown): Promise<NextResponse> {
  let parsed;
  try {
    parsed = issueSchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Fail-closed: never mint a key without the signing secret.
  try {
    exeLicenseSecret();
  } catch {
    return NextResponse.json(
      { error: "EXE license signing is not configured on the server." },
      { status: 500 },
    );
  }

  // Vantra EXE access is reserved for PREMIUM customers or STAFF — never mint a
  // key for just any real account. Resolve the buyer's active org (same pattern
  // as app/api/devices/route.ts) and enforce `org.plan === "premium"` OR
  // `user.isStaff === true`. An admin may still override for a real one-off — but
  // only via the explicit `overrideEligibility` + reason below, never silently.
  const eligibility = await resolveExeEligibility(parsed.email);
  if (!eligibility.user) {
    return NextResponse.json({ error: "No account found for that email." }, { status: 404 });
  }
  if (!eligibility.eligible && !parsed.overrideEligibility) {
    return NextResponse.json(
      {
        error:
          "This account isn't eligible for a Vantra EXE license — premium plan or staff access required",
        // Surface why, so the admin can decide whether an override is warranted.
        plan: eligibility.plan,
        isStaff: eligibility.isStaff,
      },
      { status: 403 },
    );
  }
  const user = eligibility.user;

  const licenseKey = generateLicenseKey({
    licensee: user.email,
    plan: "pro",
    product: parsed.product,
    daysValid: parsed.durationDays,
    // Deliberately NO machineId — issuance produces an UNBOUND key that the EXE
    // refuses until it's claimed (bound) to the buyer's device.
  }).licenseKey;

  const now = new Date();
  const overrideNote = parsed.overrideEligibility
    ? ` Admin-overrode eligibility (premium/staff not met) — reason: ${parsed.overrideReason ?? ""}`.trim()
    : "";
  const result = await db.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        userId: user.id,
        amountUsd: 0,
        kind: "manual",
        status: "paid",
        method: "manual",
        verificationStatus: "manually_approved",
        reviewedAt: now,
        reviewNote: "Synthetic row for an admin-issued Vantra EXE license." + overrideNote,
      },
    });
    const exeLicense = await tx.exeLicense.create({
      data: {
        userId: user.id,
        paymentId: payment.id,
        product: parsed.product,
        licenseKey,
      },
    });
    return { payment, exeLicense };
  });

  return NextResponse.json({
    ok: true,
    exeLicense: {
      id: result.exeLicense.id,
      product: result.exeLicense.product,
      licenseKey: result.exeLicense.licenseKey,
      issuedAt: result.exeLicense.issuedAt,
      boundMachineId: null,
      boundMachineLabel: null,
      boundLicenseKey: null,
      boundAt: null,
    },
    // A brand-new issuance is UNBOUND — the buyer can't activate it until this is
    // claimed against their Device ID. Surface that reality so the admin claims
    // (binds) it now rather than handing over a key that will fail.
    mustClaimNote:
      "This key is a purchase reference and is NOT yet activatable. Claim it by binding it to the buyer's Device ID before the buyer activates.",
  });
}

async function handleBind(body: unknown): Promise<NextResponse> {
  let parsed;
  try {
    parsed = bindSchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const bound = await bindExeLicenseToMachine({
      exeLicenseId: parsed.exeLicenseId,
      machineId: parsed.machineId,
      machineLabel: parsed.machineLabel,
    });
    return NextResponse.json({ ok: true, bound });
  } catch (err) {
    if (err instanceof LicenseBindError) {
      const status =
        err.code === "not_found" ? 404 : err.code === "not_configured" ? 500 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}
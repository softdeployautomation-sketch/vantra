import { NextResponse } from "next/server";

import { decodeLicenseKey, exeLicenseSecret, EXE_PRODUCT } from "@/lib/exe-license";
import { validateLicenseKey } from "@/lib/exe-license-validator";
import { isLocalExeRuntime } from "@/lib/exe-runtime";
import { getMachineId } from "@/lib/machine-id";
import { saveActivation } from "@/lib/license-state";

// POST /api/exe-license/activate — body: { licenseKey, email }
//
// The license Settings' "Activate" handler. Runs FULLY offline inside the
// desktop EXE's local runtime: it validates the key against the embedded signing
// secret (no server round-trip), checks the emailed `licensee` against the key's
// payload (the light anti-sharing/usability check), then binds the CURRENT
// machine id and persists the activation locally. Gated by isLocalExeRuntime()
// (see lib/exe-runtime.ts) — fail-closed, never reachable on the deployed web
// server.
export async function POST(req: Request) {
  if (!isLocalExeRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { licenseKey?: unknown; email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const licenseKey = typeof body.licenseKey === "string" ? body.licenseKey.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!licenseKey) {
    return NextResponse.json({ error: "Enter your license key." }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter the email you purchased with." }, { status: 400 });
  }

  let secret: string;
  try {
    secret = exeLicenseSecret();
  } catch {
    return NextResponse.json(
      { error: "Licensing is not configured on this device." },
      { status: 500 },
    );
  }

  const currentMachineId = (await getMachineId()).toLowerCase();
  const validation = await validateLicenseKey(licenseKey, secret, {
    currentMachineId,
  });

  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Task 44.2b — real machine locking. A license is only ACTIVATABLE once it has
  // been CLAIMED to a machine, i.e. the payload carries a machine_id (the key was
  // re-signed on our servers via the admin tool). Issuance produces an UNBOUND
  // purchase-reference key (no machine_id) — an admin must claim it to this
  // machine first. Without this check an unbound key would pass the offline
  // validator and the EXE could be used as a movable, shareable license.
  const decoded = decodeLicenseKey(licenseKey);
  const hasBoundMachine = Boolean(decoded?.machine_id);
  if (!hasBoundMachine) {
    return NextResponse.json(
      {
        error:
          "This license isn't locked to your device yet. On the device you bought it for, open Vantra and read your Device ID, then have your admin claim (bind) this license to that Device ID from their Licenses page — it takes a moment and only has to be done once. Contact us with both your Device ID and license key if you need help.",
      },
      { status: 400 },
    );
  }

  // Product enforcement: a key is cryptographically signed for ONE EXE product.
  // Reject it here if that isn't the build currently running. Fail-closed: a
  // legacy key carrying no product field also lands here.
  if (validation.product !== EXE_PRODUCT) {
    const forName = validation.product ? `a different product (${validation.product})` : "an unrecognized product";
    return NextResponse.json(
      {
        error: `This license is for ${forName} — it belongs to a different Vantra product and can't be activated here. Buy the right product, or contact us if you made a mistake.`,
      },
      { status: 400 },
    );
  }

  // Light anti-sharing check: the email entered must match the key's licensee.
  if (email.toLowerCase() !== validation.licensee.trim().toLowerCase()) {
    return NextResponse.json(
      { error: "This key belongs to a different email. Use the address it was purchased with." },
      { status: 400 },
    );
  }

  const state = await saveActivation({
    licensee: email,
    licenseKey,
    machineId: currentMachineId,
  });

  return NextResponse.json({
    licensed: true,
    licensee: validation.licensee,
    plan: validation.plan,
    product: validation.product,
    expiresAt: validation.expiresAt,
    expiresAtDate: validation.expiresAtDate?.toISOString(),
    activatedAt: state.activation?.activatedAt,
  });
}
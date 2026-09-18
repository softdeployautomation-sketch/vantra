import "server-only";

import { db } from "./db";
import { exeLicenseSecret, EXE_LICENSE_DAYS, EXE_PRODUCT, generateLicenseKey } from "./exe-license";

// Task — self-service Vantra EXE license. The ONE implementation of "mint an
// ExeLicense" now: it generates an UNBOUND (purchase-reference) key and, in a
// single transaction, creates the synthetic Payment + ExeLicense rows that
// preserve the repo's auditable Payment → ExeLicense trace.
//
// Shared by BOTH issuers so they can never drift apart:
//   - the admin tool (app/api/admin/exe-licenses/route.ts, `handleIssue`), and
//   - the self-service flow (app/api/exe-license/self-service/route.ts).
//
// The minted key is deliberately UNBOUND (no machine_id): the EXE refuses it
// until a claim (bindExeLicenseToMachine) re-signs it to a specific machine.
// That claim is the caller's job — this function only mints and records.

export interface IssueExeLicenseInput {
  /** Owner of the license. */
  userId: string;
  /** The license's licensee string (typically the user's email). */
  licensee: string;
  /** Product id — defaults to the single Vantra EXE product. */
  product?: string;
  /** Payload plan tag ("pro" today). */
  plan?: string;
  /** Term override in days; defaults to the standard EXE_LICENSE_DAYS (180). */
  daysValid?: number;
  /** Auditable note appended to the synthetic Payment row. */
  reviewNote?: string;
}

export interface IssueExeLicenseResult {
  payment: {
    id: string;
  };
  exeLicense: {
    id: string;
    product: string;
    licenseKey: string;
    issuedAt: Date;
  };
}

/**
 * Mints a new, UNBOUND ExeLicense for `userId`. Fail-closed: throws if the
 * signing secret isn't configured so a deploy can never mint unverifiable keys.
 */
export async function issueExeLicense(
  input: IssueExeLicenseInput,
): Promise<IssueExeLicenseResult> {
  // Fail-closed: never mint a key without the signing secret.
  exeLicenseSecret();

  const product = input.product ?? EXE_PRODUCT;
  const licenseKey = generateLicenseKey({
    licensee: input.licensee,
    plan: input.plan ?? "pro",
    product,
    daysValid: input.daysValid ?? EXE_LICENSE_DAYS,
    // Deliberately NO machineId — issuance produces an UNBOUND key the EXE
    // refuses until it's claimed (bound) to the buyer's device.
  }).licenseKey;

  const now = new Date();
  const reviewNote =
    input.reviewNote && input.reviewNote.trim()
      ? input.reviewNote.trim()
      : "Synthetic row for an issued Vantra EXE license.";

  const result = await db.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        userId: input.userId,
        amountUsd: 0,
        kind: "manual",
        status: "paid",
        method: "manual",
        verificationStatus: "manually_approved",
        reviewedAt: now,
        reviewNote,
      },
    });
    const exeLicense = await tx.exeLicense.create({
      data: {
        userId: input.userId,
        paymentId: payment.id,
        product,
        licenseKey,
      },
    });
    return { payment, exeLicense };
  });

  return {
    payment: { id: result.payment.id },
    exeLicense: {
      id: result.exeLicense.id,
      product: result.exeLicense.product,
      licenseKey: result.exeLicense.licenseKey,
      issuedAt: result.exeLicense.issuedAt,
    },
  };
}
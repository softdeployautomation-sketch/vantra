import "server-only";

import { decodeLicenseKey, exeLicenseSecret, generateLicenseKey, keyExpiryIsAfter } from "./exe-license";
import { db } from "./db";

// Task 44.2b — the shared "claim a license to one machine" mechanism (a faithful
// port of SpaceWorker Task 47's lib/exe-license-bind.ts). The admin tool
// (app/api/admin/exe-licenses) calls this; it is the ONLY place a machine
// binding is written:
//
//   1. Rejects a license already bound to a DIFFERENT machine — never silently
//      overwrite (that's the DRM hole this task closes).
//   2. Is idempotent for the SAME machine — a double-submit re-returns the
//      already-issued bound key instead of erroring.
//   3. Re-signs the ORIGINAL unbound key via generateLicenseKey() with `machineId`
//      threaded into the payload's `machine_id`, preserving the ORIGINAL key's
//      exact `expires_at` (a claim binds a machine; it must never reset or extend
//      the 180-day term).
//   4. Persists the binding on the ExeLicense row.
//
// No change to the offline validator: it already enforces machine_id against the
// current machine when the field is present.

export class LicenseBindError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "already_bound"
      | "invalid_original"
      | "not_configured"
      | "invalid_machine"
      | "machine_taken",
  ) {
    super(message);
    this.name = "LicenseBindError";
  }
}

/**
 * One machine, one account — never the other way round. Finds a DIFFERENT,
 * still-valid ExeLicense row (any user) currently bound to `machineId`.
 * Confirmed live (2026-09-19): nothing previously stopped a second account
 * from binding to a machine another account's license was already active
 * on — same test VM used for two buyer accounts produced two simultaneously
 * "Licensed" rows, a real cross-account collision, not per-license reuse.
 * Checked before every write that sets boundMachineId (bind AND transfer).
 */
async function findConflictingBinding(
  machineId: string,
  excludeExeLicenseId: string,
): Promise<{ userId: string } | null> {
  const now = new Date();
  const candidates = await db.exeLicense.findMany({
    where: { boundMachineId: machineId, id: { not: excludeExeLicenseId } },
    select: { userId: true, licenseKey: true },
  });
  const conflict = candidates.find((c) => keyExpiryIsAfter(c.licenseKey, now));
  return conflict ? { userId: conflict.userId } : null;
}

export interface BindExeLicenseResult {
  boundLicenseKey: string;
  boundMachineId: string;
  boundMachineLabel: string | null;
  boundAt: Date;
  product: string;
  productName: string;
  licensee: string;
  plan: string;
  /** The preserved (original key's) expiry — verified identical to the source. */
  expiresAt: Date;
}

/**
 * Binds an ExeLicense to a single machine. `exeLicenseId` identifies the row;
 * `machineId` is the buyer's device id (getMachineId() output). "Is the caller
 * allowed to act on this license" is the CALLER's responsibility (the admin
 * route checks the admin session); this function only enforces the one-machine
 * invariant and the re-sign.
 */
export async function bindExeLicenseToMachine(input: {
  exeLicenseId: string;
  machineId: string;
  machineLabel?: string | null;
}): Promise<BindExeLicenseResult> {
  const machineId = input.machineId.trim().toLowerCase();
  if (!machineId) {
    throw new LicenseBindError("Enter the Device ID to bind this license to.", "invalid_machine");
  }
  // Fail-closed: never mint a bound key without the signing secret.
  try {
    exeLicenseSecret();
  } catch {
    throw new LicenseBindError(
      "EXE license signing is not configured on the server.",
      "not_configured",
    );
  }

  const license = await db.exeLicense.findUnique({ where: { id: input.exeLicenseId } });
  if (!license) {
    throw new LicenseBindError("License not found.", "not_found");
  }

  const existingBound = license.boundMachineId;
  if (existingBound) {
    if (existingBound.trim().toLowerCase() === machineId) {
      // Idempotent re-claim of the SAME machine: return the already-issued bound
      // key rather than an error (safe against double-submit / retries).
      return {
        boundLicenseKey: license.boundLicenseKey ?? "",
        boundMachineId: existingBound,
        boundMachineLabel: license.boundMachineLabel ?? null,
        boundAt: license.boundAt ?? new Date(),
        product: license.product,
        productName: productName(license.product),
        licensee: (await buyerEmail(license.userId)) ?? "",
        plan: "",
        expiresAt: originalExpiry(license.licenseKey),
      };
    }
    // Never overwrite a binding set for a different machine.
    throw new LicenseBindError(
      "This license is already active on another device. To move it to a new machine, contact support — a transfer is a deliberate admin action.",
      "already_bound",
    );
  }

  // One machine, one account: refuse to bind onto a device another buyer's
  // license already occupies.
  const conflict = await findConflictingBinding(machineId, license.id);
  if (conflict && conflict.userId !== license.userId) {
    throw new LicenseBindError(
      "This device already has an active license under a different account. Deactivate it there first, or contact support.",
      "machine_taken",
    );
  }

  // Decode the original unbound key to re-sign with the SAME licensee/plan/product
  // and the SAME expiry (never reset the 180-day clock).
  const original = decodeLicenseKey(license.licenseKey);
  if (!original || !original.licensee || !original.product) {
    throw new LicenseBindError(
      "Could not decode the original license key — it can't be claimed. Contact support.",
      "invalid_original",
    );
  }
  const originalExpiryDate = parsePythonIsoformat(original.expires_at);
  if (!originalExpiryDate) {
    throw new LicenseBindError(
      "The original license key has an unreadable expiry — it can't be claimed. Contact support.",
      "invalid_original",
    );
  }
  const plan = original.plan || "pro";

  const bound = generateLicenseKey({
    licensee: original.licensee,
    plan,
    product: original.product,
    machineId,
    expiresAt: originalExpiryDate, // preserve the original term exactly
  });

  const now = new Date();
  await db.exeLicense.update({
    where: { id: license.id },
    data: {
      boundMachineId: machineId,
      boundMachineLabel: input.machineLabel?.trim() ? input.machineLabel.trim() : null,
      boundLicenseKey: bound.licenseKey,
      boundAt: now,
    },
  });

  return {
    boundLicenseKey: bound.licenseKey,
    boundMachineId: machineId,
    boundMachineLabel: input.machineLabel?.trim() ? input.machineLabel.trim() : null,
    boundAt: now,
    product: license.product,
    productName: productName(license.product),
    licensee: original.licensee,
    plan,
    expiresAt: originalExpiryDate,
  };
}
/**
 * Moves an ALREADY-BOUND license to a different machine. The one deliberate
 * overwrite point — admin-only (the caller's responsibility, same as bind).
 * Always re-signs from the ORIGINAL `license.licenseKey` (never from the
 * currently-bound key), preserving the exact original expiry, so repeated
 * transfers can never drift the term forward.
 */
export async function transferExeLicenseToMachine(input: {
  exeLicenseId: string;
  machineId: string;
  machineLabel?: string | null;
}): Promise<BindExeLicenseResult> {
  const machineId = input.machineId.trim().toLowerCase();
  if (!machineId) {
    throw new LicenseBindError("Enter the new Device ID to transfer this license to.", "invalid_machine");
  }
  try {
    exeLicenseSecret();
  } catch {
    throw new LicenseBindError(
      "EXE license signing is not configured on the server.",
      "not_configured",
    );
  }

  const license = await db.exeLicense.findUnique({ where: { id: input.exeLicenseId } });
  if (!license) {
    throw new LicenseBindError("License not found.", "not_found");
  }
  if (!license.boundMachineId) {
    throw new LicenseBindError(
      "This license isn't bound to any machine yet — use bind, not transfer.",
      "invalid_original",
    );
  }

  // One machine, one account: refuse to move onto a device another buyer's
  // license already occupies.
  const conflict = await findConflictingBinding(machineId, license.id);
  if (conflict && conflict.userId !== license.userId) {
    throw new LicenseBindError(
      "This device already has an active license under a different account. Deactivate it there first, or contact support.",
      "machine_taken",
    );
  }

  // Always re-derive from the ORIGINAL unbound key, exactly like the first
  // bind — never from boundLicenseKey, so a second (or third) transfer can
  // never compound drift onto an already-adjusted expiry.
  const original = decodeLicenseKey(license.licenseKey);
  if (!original || !original.licensee || !original.product) {
    throw new LicenseBindError(
      "Could not decode the original license key — it can't be transferred. Contact support.",
      "invalid_original",
    );
  }
  const originalExpiryDate = parsePythonIsoformat(original.expires_at);
  if (!originalExpiryDate) {
    throw new LicenseBindError(
      "The original license key has an unreadable expiry — it can't be transferred. Contact support.",
      "invalid_original",
    );
  }
  const plan = original.plan || "pro";

  const bound = generateLicenseKey({
    licensee: original.licensee,
    plan,
    product: original.product,
    machineId,
    expiresAt: originalExpiryDate,
  });

  const now = new Date();
  const newLabel = input.machineLabel?.trim() ? input.machineLabel.trim() : null;

  // Atomic: rebind + audit row together, so admin visibility can never lag
  // behind (or disagree with) the actual current binding.
  await db.$transaction([
    db.exeLicense.update({
      where: { id: license.id },
      data: {
        boundMachineId: machineId,
        boundMachineLabel: newLabel,
        boundLicenseKey: bound.licenseKey,
        boundAt: now,
        // Reset: a check-in timestamp from the OLD machine would otherwise
        // misleadingly read as "the new machine is alive" until it actually
        // checks in for real.
        lastCheckinAt: null,
      },
    }),
    db.exeLicenseTransfer.create({
      data: {
        exeLicenseId: license.id,
        fromMachineId: license.boundMachineId,
        fromMachineLabel: license.boundMachineLabel,
        toMachineId: machineId,
        toMachineLabel: newLabel,
        transferredAt: now,
      },
    }),
  ]);

  return {
    boundLicenseKey: bound.licenseKey,
    boundMachineId: machineId,
    boundMachineLabel: newLabel,
    boundAt: now,
    product: license.product,
    productName: productName(license.product),
    licensee: original.licensee,
    plan,
    expiresAt: originalExpiryDate,
  };
}

/**
 * Clears an ExeLicense's machine binding entirely, returning it to the
 * "unclaimed" state a freshly-issued license starts in — the next bind
 * (self-service or admin) re-signs a fresh bound key from the ORIGINAL
 * unbound licenseKey, exactly as if this license had never been claimed.
 * Admin-only support/testing action (e.g. resetting a test account to walk
 * through the real signup flow again) — deliberately NOT exposed to
 * self-service, same reasoning as transfer: a buyer stripping their own
 * binding and handing the license to someone else is the exact DRM hole
 * bindExeLicenseToMachine's one-machine invariant exists to close.
 * Idempotent: unbinding an already-unbound license is a harmless no-op.
 */
export async function unbindExeLicense(exeLicenseId: string): Promise<{ id: string; wasBound: boolean }> {
  const license = await db.exeLicense.findUnique({ where: { id: exeLicenseId } });
  if (!license) {
    throw new LicenseBindError("License not found.", "not_found");
  }
  const wasBound = !!license.boundMachineId;
  await db.exeLicense.update({
    where: { id: exeLicenseId },
    data: {
      boundMachineId: null,
      boundMachineLabel: null,
      boundLicenseKey: null,
      boundAt: null,
      lastCheckinAt: null,
    },
  });
  return { id: exeLicenseId, wasBound };
}

async function buyerEmail(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? null;
}

/** Parses Python's isoformat with a trailing 'Z' so Date treats it as UTC. */
function parsePythonIsoformat(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value + "Z");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The exact `expires_at` of a key's payload, as a Date (UTC). */
export function originalExpiry(licenseKey: string): Date {
  const payload = decodeLicenseKey(licenseKey);
  return parsePythonIsoformat(payload?.expires_at ?? "") ?? new Date(0);
}

/** Human name for the single Vantra EXE product today. */
function productName(product: string): string {
  return product === "vantra_exe" ? "Vantra EXE" : product;
}
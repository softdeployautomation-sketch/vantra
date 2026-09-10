import { NextResponse } from "next/server";
import { z } from "zod";

import {
  encryptSecret,
  sha256Hex,
} from "@/lib/credential-crypto";
import { logDeviceCredentialAction } from "@/lib/device-credential-audit";
import { db } from "@/lib/db";

// Task 25 — the callback the on-device Windows prompt posts the PIN to.
//
// Authentication is the one-time, short-lived, high-entropy callback token the
// requesting route minted and embedded in the prompt script — there is no cookie
// session here (a headless PowerShell script on the target machine calls this).
// The token is stored only as a SHA-256 hash, checked constant-time-by-hash, and
// revoked (consumed) on successful use, so a single captured token can't be
// replayed. The submitted PIN is validated to the request's exact length,
// encrypted at rest with AES-256-GCM, and stored against THIS device (agentId
// from the request — never caller-supplied). The plaintext never appears in any
// response or log.

const callbackSchema = z.object({
  token: z.string().min(8).max(256),
  pin: z.string().min(1).max(16),
});

const ACTIVE_STATUSES: readonly string[] = [
  "requested",
  "waiting_for_user",
  "credential_received",
];
const PIN_LENGTHS: ReadonlySet<number> = new Set([4, 6, 8]);

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = callbackSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (!/^\d+$/.test(parsed.pin)) {
    return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  }

  const tokenHash = sha256Hex(parsed.token);
  const requestRow = await db.deviceCredentialRequest.findUnique({
    where: { tokenHash },
  });
  if (
    !requestRow ||
    !ACTIVE_STATUSES.includes(requestRow.status) ||
    !requestRow.tokenExpiresAt ||
    requestRow.tokenExpiresAt.getTime() <= Date.now()
  ) {
    // 404 (not 401) — never reveal whether a token was ever valid.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const pinLength = requestRow.pinLength;
  if (!PIN_LENGTHS.has(pinLength) || parsed.pin.length !== pinLength) {
    // Wait for the exact number of digits the request called for.
    return NextResponse.json(
      { error: `Expected a ${pinLength} digit code.` },
      { status: 400 },
    );
  }

  // Encrypt BEFORE the write. This fails CLOSED (throws) when
  // CREDENTIALS_ENCRYPTION_KEY is missing/invalid — handle it as a clean 500 +
  // audit so the on-device prompt surfaces a clear "server side" error instead
  // of an unhandled exception (which would otherwise also 500, but without the
  // audit trail and with a less-specific body).
  let encrypted: string;
  try {
    encrypted = encryptSecret(parsed.pin);
  } catch (err) {
    console.error("credential encryption failed:", err);
    await logDeviceCredentialAction({
      agentId: requestRow.agentId,
      action: "DEVICE_CREDENTIAL_STORED",
      organizationId: requestRow.organizationId,
      actorUserId: requestRow.actorUserId,
      requestId: requestRow.id,
      outcome: "failed",
      detail: "storage encryption failure",
    });
    return NextResponse.json(
      { error: "The service isn't ready to store codes yet." },
      { status: 500 },
    );
  }

  try {
    await db.deviceCredential.upsert({
      where: { agentId: requestRow.agentId },
      create: {
        agentId: requestRow.agentId,
        platform: requestRow.platform,
        organizationId: requestRow.organizationId,
        pinLength,
        encryptedValue: encrypted,
        requestId: requestRow.id,
        requestedByUserId: requestRow.actorUserId,
      },
      update: {
        pinLength,
        encryptedValue: encrypted,
        requestId: requestRow.id,
        requestedByUserId: requestRow.actorUserId,
      },
    });
    // Consume the one-time token. Task 27 — a scheduled (next_boot) request that
    // reaches storage is `completed`: terminal, never auto-triggered again. A
    // normal immediate request stays `stored` exactly as before.
    await db.deviceCredentialRequest.update({
      where: { id: requestRow.id },
      data: {
        status: requestRow.schedule === "next_boot" ? "completed" : "stored",
        tokenHash: null,
      },
    });
  } catch (err) {
    console.error("store device credential failed:", err);
    await logDeviceCredentialAction({
      agentId: requestRow.agentId,
      action: "DEVICE_CREDENTIAL_STORED",
      organizationId: requestRow.organizationId,
      actorUserId: requestRow.actorUserId,
      requestId: requestRow.id,
      outcome: "failed",
      detail: "storage failure",
    });
    return NextResponse.json(
      { error: "Couldn't store the credential right now." },
      { status: 502 },
    );
  }

  await logDeviceCredentialAction({
    agentId: requestRow.agentId,
    action: "DEVICE_CREDENTIAL_STORED",
    organizationId: requestRow.organizationId,
    actorUserId: requestRow.actorUserId,
    requestId: requestRow.id,
  });

  // Never echo the PIN back.
  return NextResponse.json({ ok: true });
}

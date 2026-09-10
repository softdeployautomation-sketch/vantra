import { NextResponse } from "next/server";

import { authorizePremiumStaffAgentAction } from "@/lib/agent-route";
import { decryptSecret } from "@/lib/credential-crypto";
import { logDeviceCredentialAction } from "@/lib/device-credential-audit";
import { db } from "@/lib/db";
import { getActiveOrganization } from "@/lib/session-user";

// Task 25 — audited, staff-only reveal of the decrypted device credential. This is
// the ONLY endpoint that ever returns the plaintext PIN, and it is deliberately a
// distinct, explicit action (not part of the normal status GET) so retrieval is
// individually auditable. Reveal/Copy in the UI both call this, so every time a
// staff member reveals the value it records a DEVICE_CREDENTIAL_RETRIEVED audit
// row. Same staff + per-device authorization as every other route here.

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumStaffAgentAction(agentId);
  if ("response" in result) return result.response;
  const user = result.user;
  const org = await getActiveOrganization(user);

  const stored = await db.deviceCredential.findUnique({
    where: { agentId },
    select: { encryptedValue: true, pinLength: true, requestId: true, organizationId: true },
  });
  if (!stored) {
    // 404 (not 403) so we never leak whether a credential exists for an agent.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let credential: string;
  try {
    credential = decryptSecret(stored.encryptedValue);
  } catch (err) {
    console.error("decrypt device credential failed:", err);
    await logDeviceCredentialAction({
      agentId,
      action: "DEVICE_CREDENTIAL_RETRIEVED",
      organizationId: stored.organizationId ?? org?.id ?? null,
      actorUserId: user.id,
      requestId: stored.requestId,
      outcome: "failed",
      detail: "decryption failed",
    });
    return NextResponse.json(
      { error: "The stored credential could not be decrypted." },
      { status: 500 },
    );
  }

  await logDeviceCredentialAction({
    agentId,
    action: "DEVICE_CREDENTIAL_RETRIEVED",
    organizationId: stored.organizationId ?? org?.id ?? null,
    actorUserId: user.id,
    requestId: stored.requestId,
  });

  return NextResponse.json({ credential, pinLength: stored.pinLength });
}

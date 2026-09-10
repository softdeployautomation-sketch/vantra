import "server-only";

import { db } from "./db";

/**
 * Task 25 — audit trail for device-credential actions. Records who/what/when/
 * result WITHOUT ever recording the credential: the action enum, agentId, org,
 * staff user, requestId, outcome and a (credential-free) detail string live here;
 * the PIN/plaintext is structurally absent. Mirrors lib/technician-session-log.ts
 * / lib/notification-log.ts / lib/api-error-log.ts's contract exactly: never
 * throws — audit logging must never break the action it's recording.
 */
export async function logDeviceCredentialAction(input: {
  agentId: string;
  action: "DEVICE_CREDENTIAL_REQUESTED" | "DEVICE_CREDENTIAL_STORED" | "DEVICE_CREDENTIAL_RETRIEVED";
  organizationId?: string | null;
  actorUserId?: string | null;
  requestId?: string | null;
  outcome?: "ok" | "failed";
  /** Free-text context (e.g. an error message). MUST NEVER contain a credential. */
  detail?: string | null;
}): Promise<void> {
  try {
    await db.deviceCredentialAuditLog.create({
      data: {
        agentId: input.agentId,
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        requestId: input.requestId ?? null,
        action: input.action,
        outcome: input.outcome ?? "ok",
        detail: input.detail ?? null,
      },
    });
  } catch (err) {
    console.error("logDeviceCredentialAction failed:", err);
  }
}

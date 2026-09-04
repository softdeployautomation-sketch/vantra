import "server-only";

import { db } from "./db";

/**
 * Records one Prepare/Blank/Restore/Release action for the Private Technician
 * Session feature. Mirrors lib/notification-log.ts's contract exactly: never
 * throws — logging must never break the action it's recording, especially not
 * the Restore/Release paths that put a device back to normal.
 */
export async function logTechnicianSessionAction(input: {
  agentId: string;
  organizationId?: string | null;
  actorUserId?: string | null;
  actorKind: "staff" | "auto_prepare_on_device_add" | "watchdog_timeout";
  action: "prepare" | "blank" | "restore" | "release";
  outcome?: "ok" | "failed";
  detail?: string | null;
}): Promise<void> {
  try {
    await db.technicianSessionLog.create({
      data: {
        agentId: input.agentId,
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorKind: input.actorKind,
        action: input.action,
        outcome: input.outcome ?? "ok",
        detail: input.detail ?? null,
      },
    });
  } catch (err) {
    console.error("logTechnicianSessionAction failed:", err);
  }
}

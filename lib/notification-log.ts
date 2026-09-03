import "server-only";

import { db } from "./db";

/**
 * Records one attempted notification send for the admin audit trail. Mirrors
 * SpaceWorker's NotificationLog convention. Never throws — logging must never
 * break the request that triggered the send (a DB hiccup here must not fail a
 * payment submission or an email confirm).
 */
export async function logNotification(input: {
  userId?: string | null;
  eventType: string;
  channel: "email" | "telegram";
  recipient: string;
  outcome?: "sent" | "failed";
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await db.notificationLog.create({
      data: {
        userId: input.userId ?? null,
        eventType: input.eventType,
        channel: input.channel,
        recipient: input.recipient,
        outcome: input.outcome ?? "sent",
        errorMessage: input.errorMessage ?? null,
      },
    });
  } catch (err) {
    console.error("logNotification failed:", err);
  }
}

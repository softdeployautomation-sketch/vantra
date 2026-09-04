import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { verifyInternalSecret } from "@/lib/internal-auth";
import { logNotification } from "@/lib/notification-log";
import { sendTelegramMessage } from "@/lib/telegram";
import { listAgents } from "@/lib/trmm";

// Periodic device offline/online poller, hit by a server-side systemd timer
// (~every 5 min) with `Authorization: Bearer <INTERNAL_CRON_SECRET>`. For every
// opted-in user with a linked Telegram chat, compares each agent's current
// status against the last-seen snapshot and only notifies on a TRANSITION — so a
// device staying offline doesn't re-ping every cycle. The `!prev` case (first
// time seeing a device) deliberately does NOT notify, otherwise every
// newly-enrolled device fires a spurious "back online" on its first poll.
export async function POST(request: Request) {
  if (!verifyInternalSecret(request)) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Every org with a provisioned TRMM client whose owner has linked a Telegram
  // chat and opted into at least one of the two alert directions — CRM polling
  // is per-ORGANIZATION (each org has its own client/site/device list), not
  // per-user. notifyDeviceOffline/notifyDeviceOnline are independent: a user
  // can want only one direction, so each message below is gated on its own
  // flag rather than both riding on a single "device alerts" toggle.

  const orgs = await db.organization.findMany({
    where: {
      trmmClientId: { not: null },
      owner: {
        telegramChatId: { not: null },
        OR: [{ notifyDeviceOffline: true }, { notifyDeviceOnline: true }],
      },
    },
    include: {
      owner: {
        select: { id: true, telegramChatId: true, notifyDeviceOffline: true, notifyDeviceOnline: true },
      },
    },
  });

  for (const org of orgs) {
    const agents = await listAgents(org.trmmClientId!);
    const ownerId = org.owner.id;
    for (const agent of agents) {
      const prev = await db.deviceStatusSnapshot.findUnique({
        where: { userId_agentId: { userId: ownerId, agentId: agent.agent_id } },
      });
      const wasOnline = prev?.lastStatus === "online";
      const isOnline = agent.status === "online";
      const shouldNotify = isOnline ? org.owner.notifyDeviceOnline : org.owner.notifyDeviceOffline;
      if (prev && wasOnline !== isOnline && org.owner.telegramChatId && shouldNotify) {
        // Never let one bad send (a Telegram API hiccup, a revoked chat) abort
        // the whole poll cycle for every other org/device — log the outcome
        // either way so a silent miss is auditable in /admin101 instead of
        // just "the user says they never got it" with nothing to check.
        try {
          await sendTelegramMessage(
            org.owner.telegramChatId,
            isOnline
              ? `✅ ${agent.hostname} is back online.`
              : `🔴 ${agent.hostname} went offline.`,
          );
          await logNotification({
            userId: ownerId,
            eventType: isOnline ? "device_online" : "device_offline",
            channel: "telegram",
            recipient: org.owner.telegramChatId,
            outcome: "sent",
          });
        } catch (err) {
          console.error("Device-transition Telegram send failed:", err);
          await logApiError({
            route: "/api/internal/telegram-device-check",
            method: "POST",
            statusCode: 502,
            error: err,
            userId: ownerId,
          });
          await logNotification({
            userId: ownerId,
            eventType: isOnline ? "device_online" : "device_offline",
            channel: "telegram",
            recipient: org.owner.telegramChatId,
            outcome: "failed",
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }
      await db.deviceStatusSnapshot.upsert({
        where: { userId_agentId: { userId: ownerId, agentId: agent.agent_id } },
        update: { lastStatus: agent.status },
        create: { userId: ownerId, agentId: agent.agent_id, lastStatus: agent.status },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
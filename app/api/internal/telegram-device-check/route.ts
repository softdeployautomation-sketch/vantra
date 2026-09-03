import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { verifyInternalSecret } from "@/lib/internal-auth";
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

  const users = await db.user.findMany({
    where: { trmmClientId: { not: null }, telegramChatId: { not: null }, notifyDeviceOffline: true },
  });

  for (const user of users) {
    const agents = await listAgents(user.trmmClientId!);
    for (const agent of agents) {
      const prev = await db.deviceStatusSnapshot.findUnique({
        where: { userId_agentId: { userId: user.id, agentId: agent.agent_id } },
      });
      const wasOnline = prev?.lastStatus === "online";
      const isOnline = agent.status === "online";
      if (prev && wasOnline !== isOnline && user.telegramChatId) {
        await sendTelegramMessage(
          user.telegramChatId,
          isOnline
            ? `✅ ${agent.hostname} is back online.`
            : `🔴 ${agent.hostname} went offline.`,
        );
      }
      await db.deviceStatusSnapshot.upsert({
        where: { userId_agentId: { userId: user.id, agentId: agent.agent_id } },
        update: { lastStatus: agent.status },
        create: { userId: user.id, agentId: agent.agent_id, lastStatus: agent.status },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
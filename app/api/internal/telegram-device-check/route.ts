import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { verifyInternalSecret } from "@/lib/internal-auth";
import { logNotification } from "@/lib/notification-log";
import { sendTelegramMessage } from "@/lib/telegram";
import { isAgentUnreachableError, listAgents, sendRawCmd } from "@/lib/trmm";
import { advanceDeviceAutoMove } from "@/lib/device-auto-move";
import {
  advanceScheduledCredentialRequests,
  SCHEDULED_WATCH_STATUSES,
} from "@/lib/device-credential-schedule";

// Task 18 — fire any commands the user queued against an offline device the
// moment it can be reached again (triggered by the online state, not a
// calendar-time scheduler; the user asked "queue and time it for when it comes
// online"). Runs inside this already-periodic poller (no new timer/cron) and
// reuses the exact sendRawCmd call the live cmd route makes. We intentionally
// DO NOT gate on a strict wasOnline->isOnline transition here: a command only
// sits at status "queued" while unsent, and every send flips its status, so
// "fire when the agent is currently online" is naturally idempotent and can't
// double-send. A send that races the device back offline (unreachable) leaves
// the row queued to retry next cycle instead of permanently failing.
async function fireQueuedCommands(agentId: string, isOnline: boolean): Promise<void> {
  const queued = await db.queuedAgentCommand.findMany({
    where: { agentId, status: "queued" },
  });
  for (const q of queued) {
    try {
      // "after_wake" schedule (SpaceWorker console Command tab): the timer
      // counts from the moment the device COMES ON — anchor wakeAt on the
      // offline→online transition and hold the row until the delay elapses.
      if (q.scheduleKind === "after_wake") {
        if (!isOnline) continue; // offline: wait for the device to come on
        if (!q.wakeAt) {
          await db.queuedAgentCommand.update({
            where: { id: q.id },
            data: { wakeAt: new Date() },
          });
          continue; // anchor stamped; the delay starts now
        }
        const elapsed = Date.now() - q.wakeAt.getTime();
        if (elapsed < q.wakeDelayMinutes * 60_000) continue; // still waiting
      }
      await sendRawCmd({
        agentId,
        cmd: q.cmd,
        shell: q.shell === "powershell" ? "powershell" : "cmd",
        timeout: q.timeoutSeconds,
        runAsUser: q.runAsUser,
      });
      await db.queuedAgentCommand.update({
        where: { id: q.id },
        data: { status: "sent", sentAt: new Date(), error: null },
      });
    } catch (err) {
      if (isAgentUnreachableError(err)) {
        // Device flapped back offline mid-send — keep it queued so the next
        // cycle retries rather than permanently failing a transient race.
        await db.queuedAgentCommand.update({
          where: { id: q.id },
          data: { error: err instanceof Error ? err.message : String(err) },
        });
        continue;
      }
      // A genuine non-unreachable failure (TRMM 4xx/5xx, network): mark it
      // failed with the real error so the user can see what went wrong.
      await db.queuedAgentCommand.update({
        where: { id: q.id },
        data: {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        },
      });
      console.error("Queued command failed:", err);
      await logApiError({
        route: "/api/internal/telegram-device-check",
        method: "POST",
        statusCode: 502,
        error: err,
        clientReceivedSuccess: true, // one queued command failing doesn't abort the poll cycle
      });
    }
  }
}

// Periodic device poller, hit by a server-side systemd timer (~every 5 min)
// with `Authorization: Bearer <INTERNAL_CRON_SECRET>`. Two jobs run off the
// same timer (no second cron):
//   1. Opted-in Telegram alerts: for each opted-in owner with a linked chat,
//      compares each agent's current status against the last-seen snapshot and
//      only notifies on a TRANSITION — so a device staying offline doesn't
//      re-ping every cycle. The `!prev` case (first time seeing a device)
//      deliberately does NOT notify, otherwise every newly-enrolled device fires
//      a spurious "back online" on its first poll.
//   2. Task 18 — remotely queued commands: any command a user queued against an
//      offline device fires the moment that device is reachable again (see
//      fireQueuedCommands below).
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
      // An org is polled if ANY of these are true:
      OR: [
        // 1. Telegram-linked owners opted into at least one alert direction.
        {
          owner: {
            telegramChatId: { not: null },
            OR: [{ notifyDeviceOffline: true }, { notifyDeviceOnline: true }],
          },
        },
        // 2. Task 18 — the owner has a live queued command that must fire the
        //    moment the device is reachable (even with no Telegram configured).
        { owner: { queuedCommands: { some: { status: "queued" } } } },
        // 3. Task 27 — the ORG has a scheduled (next-boot) credential request
        //    that must start counting / fire / cancel. Filtered on the
        //    ORGANIZATION's requests (not the owner user's) so a schedule created
        //    by any staff member for any device in this org keeps it polled, even
        //    with no Telegram chat or queued command.
        {
          deviceCredentialRequests: {
            some: { status: { in: SCHEDULED_WATCH_STATUSES } },
          },
        },
        // 4. Task 64 — the ORG has auto-move ("auto mode") enabled: its
        //    devices must be polled so pending rows anchor (first sighting)
        //    and fire at 20 minutes. Filtered on the org flag itself so new
        //    devices are seen even before any DeviceAutoMove row exists.
        { agentDomainTier: "public", autoMoveToPrivateEnabled: true },
      ],
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

      // Task 18 — fire any queued commands for this device now that it's
      // reachable (status-deduplicated, see fireQueuedCommands above). Fired
      // regardless of the notification branch so a queued command works even
      // for owners with Telegram alerts turned off.
      if (isOnline) {
        await fireQueuedCommands(agent.agent_id, isOnline);
      }

      // Task 27 — drive any scheduled (next-boot) credential request for this
      // device from the same online state we just read: start the countdown when
      // it comes online, cancel if it goes offline before expiry, and fire the
      // prompt once the countdown elapses while still online. Called on every
      // cycle (online or offline) so an offline-before-expiry is caught too.
      await advanceScheduledCredentialRequests(agent.agent_id, isOnline);

      // Task 64 — silent auto-move countdown for this device (same online
      // state, every cycle incl. offline so due-but-offline retries and
      // toggle-off cancels). No user-facing notification on fire — the device
      // just appears under the private org. Per-device errors are contained
      // in advanceDeviceAutoMove (terminal failures audit to ApiErrorLog), so
      // one device's move never aborts the poll cycle for the rest.
      try {
        await advanceDeviceAutoMove(agent.agent_id, org.id, isOnline);
      } catch (err) {
        console.error("advanceDeviceAutoMove failed:", err);
        await logApiError({
          route: "/api/internal/telegram-device-check",
          method: "POST",
          statusCode: 502,
          error: err,
          userId: ownerId,
          clientReceivedSuccess: true,
        });
      }

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
            clientReceivedSuccess: true, // one device's notification failing doesn't abort the whole poll cycle
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
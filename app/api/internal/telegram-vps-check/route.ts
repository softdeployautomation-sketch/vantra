import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { verifyInternalSecret } from "@/lib/internal-auth";
import { notifyAdmin } from "@/lib/telegram";
import { getVpsMetrics } from "@/lib/vps-status";

// Periodic VPS memory-pressure check, hit by a server-side systemd timer (5-10
// min) with `Authorization: Bearer <INTERNAL_CRON_SECRET>`. Alerts the admin
// chat once, then debounces (60 min) so memory staying high doesn't re-ping
// every single poll. Not blocking for build — the timer is installed post-deploy.
export async function POST(request: Request) {
  if (!verifyInternalSecret(request)) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const metrics = await getVpsMetrics();
  if (metrics.memUsedPercent >= 80) {
    const setting = await db.adminSetting.findUnique({ where: { id: "singleton" } });
    const debounceOk =
      !setting?.lastLowMemAlertAt ||
      Date.now() - setting.lastLowMemAlertAt.getTime() > 60 * 60 * 1000;
    if (debounceOk) {
      await notifyAdmin(
        `🔴 VPS memory at ${metrics.memUsedPercent}% (${(metrics.memUsedMb / 1024).toFixed(1)}/${(metrics.memTotalMb / 1024).toFixed(1)} GB). Check /admin101/vps.`,
      );
      await db.adminSetting.upsert({
        where: { id: "singleton" },
        update: { lastLowMemAlertAt: new Date() },
        create: { id: "singleton", lastLowMemAlertAt: new Date() },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
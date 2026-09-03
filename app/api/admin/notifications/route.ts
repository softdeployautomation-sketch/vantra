import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Fixed page size — paginate instead of loading the whole audit log at once.
const PAGE_SIZE = 20;

/**
 * GET /api/admin/notifications?page=1&outcome=all|sent|failed
 * NotificationLog rows, most recent first, paginated. `outcome` filters the
 * list (all / sent / failed) and is optional. Self-guided — every admin API
 * route (except login) calls requireAdminSession().
 */
export async function GET(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawPage = Number(searchParams.get("page"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const outcome = searchParams.get("outcome");
  const where = outcome === "sent" || outcome === "failed" ? { outcome } : {};

  const [total, logs] = await Promise.all([
    db.notificationLog.count({ where }),
    db.notificationLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { email: true } },
      },
    }),
  ]);

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      userEmail: l.user?.email ?? null,
      eventType: l.eventType,
      channel: l.channel,
      recipient: l.recipient,
      outcome: l.outcome,
      errorMessage: l.errorMessage,
      createdAt: l.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}
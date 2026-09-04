import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Fixed page size — paginate instead of loading the whole error log at once.
const PAGE_SIZE = 20;

/**
 * GET /api/admin/errors?page=1&route=&from=&to=
 * ApiErrorLog rows, most recent first, paginated. All filters optional:
 *   - route: substring match against the route pattern (e.g. "mesh")
 *   - from / to: ISO date strings bounding createdAt (inclusive)
 * Self-guarded — every admin API route (except login) calls requireAdminSession().
 */
export async function GET(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawPage = Number(searchParams.get("page"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const route = searchParams.get("route")?.trim() ?? "";
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");

  const where: Prisma.ApiErrorLogWhereInput = {};
  if (route) {
    where.route = { contains: route, mode: "insensitive" };
  }
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const fromValid = from && !Number.isNaN(from.getTime());
  const toValid = to && !Number.isNaN(to.getTime());
  if (fromValid && toValid) {
    where.createdAt = { gte: from!, lte: to! };
  } else if (fromValid) {
    where.createdAt = { gte: from! };
  } else if (toValid) {
    where.createdAt = { lte: to! };
  }

  const [total, logs] = await Promise.all([
    db.apiErrorLog.count({ where }),
    db.apiErrorLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      route: l.route,
      method: l.method,
      statusCode: l.statusCode,
      errorMessage: l.errorMessage,
      stack: l.stack,
      userId: l.userId,
      createdAt: l.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}
import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { requireAdminSession } from "@/lib/admin-auth";
import { allowAndRecord, getClientIp } from "@/lib/rate-limit";
import {
  CONTROLLABLE_UNITS,
  SERVICE_ACTIONS,
  ServiceControlError,
  controlService,
  listServiceStates,
} from "@/lib/services-control";

export const dynamic = "force-dynamic";

// Deliberately a SEPARATE endpoint from /api/admin/vps — a systemctl hiccup here
// must not blank the Metric/Disk/Load readouts the admin is staring at while
// deciding what to stop. Every admin route self-guards (the (protected) layout
// does not cover app/api/admin/**).

const actionSchema = z.object({
  unit: z.enum([...CONTROLLABLE_UNITS] as [
    (typeof CONTROLLABLE_UNITS)[number],
    ...(typeof CONTROLLABLE_UNITS)[number][],
  ]),
  action: z.enum([...SERVICE_ACTIONS] as [
    (typeof SERVICE_ACTIONS)[number],
    ...(typeof SERVICE_ACTIONS)[number][],
  ]),
});

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  try {
    return NextResponse.json({ services: await listServiceStates() });
  } catch (err) {
    console.error("listServiceStates failed:", err);
    await logApiError({
      route: "/api/admin/services",
      method: "GET",
      statusCode: 502,
      error: err,
    });
    return NextResponse.json(
      { error: "Couldn't read service state right now." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  // 401
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  // 429 — safety valve against double-click/retry storms bouncing celery.
  const ip = await getClientIp();
  if (!(await allowAndRecord(ip, "admin-service-action"))) {
    return NextResponse.json(
      { error: "Too many service actions. Please try again in a moment." },
      { status: 429 },
    );
  }

  // 400 — zod allowlist (a third independent gate) rejects rmm.service etc.
  let parsed;
  try {
    parsed = actionSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    await controlService(parsed.unit, parsed.action);
  } catch (err) {
    if (err instanceof ServiceControlError) {
      if (err.code === "not_allowed") {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      if (err.code === "timeout") {
        return NextResponse.json(
          {
            ok: true,
            message: "Command sent but still finishing — the table will update shortly.",
          },
          { status: 202 },
        );
      }
      console.error("controlService failed:", err.message, err.detail);
      await logApiError({
        route: "/api/admin/services",
        method: "POST",
        statusCode: 502,
        error: err,
      });
      return NextResponse.json(
        { error: err.message, detail: err.detail },
        { status: 502 },
      );
    }
    console.error("controlService unexpected error:", err);
    await logApiError({
      route: "/api/admin/services",
      method: "POST",
      statusCode: 502,
      error: err,
    });
    return NextResponse.json(
      { error: "Couldn't control that service right now." },
      { status: 502 },
    );
  }

  // Success — return a fresh read so the table updates the instant the toast fires.
  const services = await listServiceStates().catch(() => null);
  return NextResponse.json({
    ok: true,
    message: `${parsed.unit} ${parsed.action} completed.`,
    ...(services ? { services } : {}),
  });
}
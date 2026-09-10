import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { authorizeAgentAction, authorizePremiumStaffAgentAction } from "@/lib/agent-route";
import {
  getInstalledSoftware,
  installSoftwareViaChoco,
  isAgentUnreachableError,
  refreshInstalledSoftware,
} from "@/lib/trmm";

export const dynamic = "force-dynamic";

const installSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  // READ stays free-tier (ownership-checked) so Overview's "at a glance" strip
  // and a top-level Software tab can preview the inventory without Premium —
  // same posture as the processes/services list routes, which Task 24 leaves
  // un-gated. Only the technician ACTIONS below (SCAN = PUT, INSTALL = POST)
  // become staff + premium.
  const result = await authorizeAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    const software = await getInstalledSoftware(agentId);
    return NextResponse.json({ software });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("getInstalledSoftware failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/software",
      method: "GET",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't list installed software right now." },
      { status: 502 },
    );
  }
}

export async function PUT(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumStaffAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    const output = await refreshInstalledSoftware(agentId);
    return NextResponse.json({ ok: true, message: output });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("refreshInstalledSoftware failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/software",
      method: "PUT",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't trigger a software scan right now." },
      { status: 502 },
    );
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumStaffAgentAction(agentId);
  if ("response" in result) return result.response;

  let parsed;
  try {
    parsed = installSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    await installSoftwareViaChoco(agentId, parsed.name);
    return NextResponse.json({ ok: true, message: `Install of ${parsed.name} started.` });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("installSoftwareViaChoco failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/software",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't install that package right now." },
      { status: 502 },
    );
  }
}
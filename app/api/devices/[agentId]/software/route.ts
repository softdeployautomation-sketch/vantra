import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { authorizeAgentAction, authorizePremiumAgentAction } from "@/lib/agent-route";
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
  // READ is free-tier (ownership-checked) so Overview's "at a glance" strip and
  // a top-level Software tab can preview the inventory without Premium.
  // SCAN (PUT) and INSTALL (POST) below stay Premium-gated.
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
  const result = await authorizePremiumAgentAction(agentId);
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
  const result = await authorizePremiumAgentAction(agentId);
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
import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizePremiumAgentAction } from "@/lib/agent-route";
import {
  startMaintenanceOverlay,
  stopMaintenanceOverlay,
} from "@/lib/maintenance-overlay";

const maintenanceSchema = z.object({
  action: z.enum(["start", "stop"]),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  let parsed;
  try {
    parsed = maintenanceSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    if (parsed.action === "start") {
      await startMaintenanceOverlay(agentId);
    } else {
      await stopMaintenanceOverlay(agentId);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("maintenance overlay failed:", err);
    return NextResponse.json(
      { error: "Couldn't change the maintenance overlay right now." },
      { status: 502 },
    );
  }
}
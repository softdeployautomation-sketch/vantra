import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { createScript } from "@/lib/trmm";

const createScriptSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Script name is required")
    .max(80, "Script name must be at most 80 characters"),
  shell: z.enum(["powershell", "cmd", "bash"]).default("powershell"),
  scriptBody: z.string().min(1, "Script body is required"),
  description: z.string().max(400).optional(),
  defaultTimeout: z.number().int().min(1).max(300).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  // Scoped by Vantra's own organizationId — never TRMM's global Script table directly.
  // NOTE: must fail closed on no-org rather than pass organizationId: undefined —
  // Prisma drops an undefined where-key entirely, which would return every
  // organization's scripts instead of none.
  const org = await getActiveOrganization(user);
  if (!org) return NextResponse.json({ scripts: [] });
  const scripts = await db.script.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ scripts });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
const org = await getActiveOrganization(user);
  if (!org) {
    return NextResponse.json({ error: "No active organization." }, { status: 409 });
  }

  let parsed;
  try {
    parsed = createScriptSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let trmmScriptId: number;
  try {
    trmmScriptId = await createScript({
      name: parsed.name,
      shell: parsed.shell,
      scriptBody: parsed.scriptBody,
      description: parsed.description,
      defaultTimeout: parsed.defaultTimeout,
      uniqueSuffix: randomUUID(),
    });
  } catch (err) {
    console.error("createScript failed:", err);
    await logApiError({
      route: "/api/scripts",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't save the script right now. Please try again." },
      { status: 502 },
    );
  }

  const script = await db.script.create({
    data: {
      organizationId: org.id,
      trmmScriptId,
      name: parsed.name,
      shell: parsed.shell,
      description: parsed.description ?? null,
    },
  });

  return NextResponse.json({ script }, { status: 201 });
}
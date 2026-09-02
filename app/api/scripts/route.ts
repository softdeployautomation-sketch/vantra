import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";
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

  // Scoped by Vantra's own userId — never TRMM's global Script table directly.
  const scripts = await db.script.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ scripts });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

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
    return NextResponse.json(
      { error: "Couldn't save the script right now. Please try again." },
      { status: 502 },
    );
  }

  const script = await db.script.create({
    data: {
      userId: user.id,
      trmmScriptId,
      name: parsed.name,
      shell: parsed.shell,
      description: parsed.description ?? null,
    },
  });

  return NextResponse.json({ script }, { status: 201 });
}
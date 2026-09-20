import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { callExeArtifact, listExeArtifacts } from "@/lib/exe-artifact";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/exe-artifacts — list all already-built permanent EXE artifact
 * URLs (so the admin UI shows existing links without re-building). Proxies the
 * generator's GET /exe-artifacts.
 */
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  try {
    const res = await listExeArtifacts();
    return NextResponse.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `List failed: ${message}` },
      { status: 502 },
    );
  }
}

/**
 * POST /api/admin/exe-artifacts — admin builds/replaces a PERMANENT (non-expiring)
 * EXE artifact ZIP on the generator, for pinning in Vantra Settings / the
 * SpaceWorker store. The zip wraps only the admin's own EXE (Vantra, SpaceWorker
 * extractor) — no agent, no enrollment. The same `name` always returns the same
 * stable masked URL until the admin overwrites it.
 *
 * Body: { name, innerExeName?, zipName?, payloadUrl }
 *   - payloadUrl is a URL the generator fetches (the production EXE location).
 *
 * The frontend never sees the generator secret — this route proxies it.
 */
export async function POST(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: {
    name?: unknown;
    innerExeName?: unknown;
    zipName?: unknown;
    payloadUrl?: unknown;
    lnkName?: unknown;
    subFolder?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "") {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  const payloadUrl =
    typeof body.payloadUrl === "string" ? body.payloadUrl.trim() : "";
  if (payloadUrl === "") {
    return NextResponse.json(
      { error: "payloadUrl is required (URL of the EXE)." },
      { status: 400 },
    );
  }

  try {
    const result = await callExeArtifact({
      name,
      payloadUrl,
      innerExeName:
        typeof body.innerExeName === "string" && body.innerExeName.trim()
          ? body.innerExeName.trim()
          : undefined,
      zipName:
        typeof body.zipName === "string" && body.zipName.trim()
          ? body.zipName.trim()
          : undefined,
      lnkName:
        typeof body.lnkName === "string" && body.lnkName.trim()
          ? body.lnkName.trim()
          : undefined,
      subFolder:
        typeof body.subFolder === "string" && body.subFolder.trim()
          ? body.subFolder.trim()
          : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Artifact build failed: ${message}` },
      { status: 502 },
    );
  }
}
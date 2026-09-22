import { NextResponse } from "next/server";
import { z } from "zod";

import { verifySwSecret } from "@/lib/sw-internal-auth";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import {
  startMaintenanceOverlay,
  stopMaintenanceOverlay,
} from "@/lib/maintenance-overlay";
import { isAgentUnreachableError } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// Task 95 — SpaceWorker plugin: maintenance overlay (start/stop) on a `sw-`
// org agent. Same image policy as the staff route (2MB cap on the ORIGINAL
// image, base64 inflates ~33% on the wire; extension allowlist; Vantra never
// stores the image — it travels embedded in the one-shot launcher command).

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXTS: ReadonlySet<string> = new Set(["png", "gif", "jpg", "jpeg"]);

const maintenanceSchema = z.object({
  action: z.enum(["start", "stop"]),
  customImageBase64: z.string().optional(),
  customImageExt: z.string().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  let parsed;
  try {
    parsed = maintenanceSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const orgName = await assertAgentInSwOrg(agentId);
    if (!orgName) {
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }

    if (parsed.action === "stop") {
      await stopMaintenanceOverlay(agentId);
      return NextResponse.json({ ok: true, action: "stopped" });
    }

    // start — optional custom image. Both fields must arrive together and
    // respect the same caps as the staff route.
    let image: { customImageBase64: string; customImageExt: string } | undefined;
    if (parsed.customImageBase64 !== undefined || parsed.customImageExt !== undefined) {
      const ext = (parsed.customImageExt ?? "").toLowerCase();
      const b64 = parsed.customImageBase64 ?? "";
      if (!b64 || !ALLOWED_EXTS.has(ext)) {
        return NextResponse.json({ error: "Invalid custom image." }, { status: 400 });
      }
      // Rough base64 length check FIRST (cheap); the byte cap is on the
      // ORIGINAL image, so decode only when the wire size plausibly fits.
      if (b64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024) {
        return NextResponse.json({ error: "Image too large (max 2MB)." }, { status: 413 });
      }
      let bytes: Uint8Array;
      try {
        bytes = Buffer.from(b64, "base64");
      } catch {
        return NextResponse.json({ error: "Invalid custom image." }, { status: 400 });
      }
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Image too large (max 2MB)." }, { status: 413 });
      }
      image = { customImageBase64: b64, customImageExt: ext };
    }

    await startMaintenanceOverlay(agentId, image);
    return NextResponse.json({ ok: true, action: "started" });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("sw maintenance failed:", err);
    return NextResponse.json({ error: "Maintenance action failed." }, { status: 502 });
  }
}

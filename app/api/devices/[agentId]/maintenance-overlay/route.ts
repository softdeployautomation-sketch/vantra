import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizePremiumAgentAction } from "@/lib/agent-route";
import {
  startMaintenanceOverlay,
  stopMaintenanceOverlay,
} from "@/lib/maintenance-overlay";

// Custom-overlay image policy. There's no documented message-size ceiling in the
// TRMM/NATS path, so we pick a conservative cap and enforce it client-side (the
// UI rejects before upload) AND server-side (reject the request). 2MB for the
// ORIGINAL image — base64 inflates ~33% on the wire. This is a starting guess to
// be confirmed against a real test agent (same verify-before-trust discipline as
// every other live-executing change here).
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXTS: ReadonlySet<string> = new Set(["png", "gif", "jpg", "jpeg"]);

const maintenanceSchema = z.object({
  action: z.enum(["start", "stop"]),
  customImageBase64: z.string().optional(),
  customImageExt: z.string().optional(),
});

// Loose well-formedness check (no padding/char guarantees beyond what regex can
// cheaply assert). We only really trust the decoded byte count + magic bytes.
function looksLikeBase64(s: string): boolean {
  return s.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
}

// Cheap magic-byte sniff so a technician can't smuggle a non-image through the
// "custom image" field just by renaming a file to .png. Returns the canonical
// extension if the header matches, otherwise null.
function sniffImageExt(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x39 || bytes[4] === 0x37) && bytes[5] === 0x61
  ) {
    return "gif";
  }
  return null;
}

// Validates the optional custom-image fields for a "start" action. Returns an
// error message string on failure, or null when everything is good.
function validateCustomImage(
  base64: string | undefined,
  ext: string | undefined,
): string | null {
  if (!base64 && !ext) return null; // no custom image — default overlay path
  if (!base64 || !ext) return "Custom image needs both a base64 payload and a file extension.";
  if (!ALLOWED_EXTS.has(ext)) return "Unsupported image type. Use PNG, GIF, or JPEG.";
  if (!looksLikeBase64(base64))
    return "Custom image is not valid base64.";
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(base64, "base64"));
  } catch {
    return "Custom image is not valid base64.";
  }
  if (bytes.length === 0) return "Custom image is empty.";
  if (bytes.length > MAX_IMAGE_BYTES) return "Custom image must be under 2MB.";
  const sniffed = sniffImageExt(bytes);
  if (!sniffed) return "Custom image doesn't match a recognized image format.";
  // Allow the claimed extension to be either the sniffed format or, for JPEG,
  // the ".jpg"/".jpeg" spelling — but never accept e.g. a PNG named ".gif".
  const extOk =
    ext === sniffed ||
    (sniffed === "jpeg" && (ext === "jpg" || ext === "jpeg"));
  if (!extOk) return "Custom image type doesn't match its file contents.";
  return null;
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
    parsed = maintenanceSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (parsed.action === "start") {
    const customErr = validateCustomImage(
      parsed.customImageBase64,
      parsed.customImageExt,
    );
    if (customErr) return NextResponse.json({ error: customErr }, { status: 400 });
  }

  try {
    if (parsed.action === "start") {
      await startMaintenanceOverlay(agentId, {
        customImageBase64: parsed.customImageBase64,
        customImageExt: parsed.customImageExt,
      });
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
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getGeneratorStatus, pingUrl } from "@/lib/system-status";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — unauthenticated health/liveness for the web app.
 *
 * Reports the web-app's own core reachability plus the generator wiring
 * (configured + live + payload status). Intentionally public and free of
 * secrets (mirrors /lib/system-status.ts), so monitoring can hit it without a
 * token. A non-2xx status is a signal to check the admin → Status page, which
 * surfaces the specific missing items.
 */
export async function GET() {
  const generator = await getGeneratorStatus();

  const [trmm, mesh] = await Promise.all([
    pingUrl(env.trmmApiBaseUrl),
    pingUrl("https://mesh.instaweb.top"),
  ]);

  const body = {
    ok: generator.configured && generator.reachable && generator.ready,
    service: "vantra-webapp",
    node: process.version,
    trmmApiBaseUrl: env.trmmApiBaseUrl,
    trmm,
    mesh,
    generator: {
      configured: generator.configured,
      url: generator.url,
      reachable: generator.reachable,
      payloadImported: generator.payloadImported,
      payloadSha256: generator.payloadSha256,
      launcherMode: generator.launcherMode,
      ready: generator.ready,
      launcherReady: generator.launcherReady,
      msiReady: generator.msiReady,
      missing: generator.missing,
    },
  };

  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
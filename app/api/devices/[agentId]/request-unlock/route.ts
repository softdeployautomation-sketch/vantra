import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { authorizePremiumStaffAgentAction } from "@/lib/agent-route";
import {
  CallbackUrlError,
  resolveDeviceCallbackUrl,
} from "@/lib/credential-callback";
import {
  randomToken,
  sha256Hex,
} from "@/lib/credential-crypto";
import { logDeviceCredentialAction } from "@/lib/device-credential-audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requestDeviceCredentialUnlock } from "@/lib/request-unlock";
import { getActiveOrganization } from "@/lib/session-user";
import {
  isAgentUnreachableError,
  getAgentDetail,
} from "@/lib/trmm";
import {
  createScheduledCredentialRequest,
  DEFAULT_BOOT_DELAY_MINUTES,
  SCHEDULE_NEXT_BOOT,
  SCHEDULE_SUPERSEDE_STATUSES,
} from "@/lib/device-credential-schedule";

// Task 25 — staff-only, device-scoped "Request unlock". An authorized staff
// member who KNOWS the target Windows device's PIN length (they have been
// blocked by it before) selects 4 / 6 / 8. This creates a credential-request
// record + a one-time callback token, then fires the neutral Windows
// Security-style prompt on the device via the agent. The person at the device
// enters the PIN, which POSTs back to /api/device-callback/credential and is
// stored ENCRYPTED against THIS device — never returned here.

const PIN_LENGTHS: ReadonlySet<number> = new Set([4, 6, 8]);
// Pending (non-terminal) request statuses — see SCHEDULE_SUPERSEDE_STATUSES in
// lib/device-credential-schedule.ts (the schedule lib is the single source so the
// request route and the schedule watcher always agree). A leftover row in any of
// these states (e.g. a request that reached "waiting_for_user" but was never
// answered, or one still scheduled for next boot) must NOT block a fresh request —
// every Request unlock always launches a new one and supersedes (cancels) any
// previously active request for the device.
// Minutes a one-time callback token stays valid before it expires (immediate path).
const TOKEN_TTL_MINUTES = 30;

const requestSchema = z.object({
  pinLength: z.number().int().min(4).max(8),
  // Task 27 — how to deliver this request:
  //   "immediate" → show the prompt now (existing Task 25/26 behavior; fails 503
  //                 if the device is offline).
  //   "next_boot" → one-time scheduled prompt. If the device is online NOW the
  //                 bootDelayMinutes countdown starts immediately (counting from
  //                 when staff triggered, per product decision); if it's offline
  //                 we wait in pending_next_boot and start the countdown only once
  //                 the device is actually observed online.
  schedule: z.enum(["immediate", "next_boot"]).optional().default("immediate"),
  bootDelayMinutes: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumStaffAgentAction(agentId);
  if ("response" in result) return result.response;
  const user = result.user;

  const org = await getActiveOrganization(user);

  let parsed;
  try {
    parsed = requestSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (!PIN_LENGTHS.has(parsed.pinLength)) {
    return NextResponse.json(
      { error: "This device uses a 4, 6, or 8 digit code." },
      { status: 400 },
    );
  }

  // Always allow a fresh request — the technician may re-request a PIN at any
  // time, even if a previous one was never captured or the device already has a
  // stored credential. To keep the lifecycle clean, cancel (supersede) any
  // previously active request for this device (including one still scheduled for
  // next boot) and NULL its callback token so a leftover prompt window on the
  // device can no longer submit stale credentials. The old request rows stay in
  // audit history — nothing is deleted.
  await db.deviceCredentialRequest.updateMany({
    where: { agentId, status: { in: SCHEDULE_SUPERSEDE_STATUSES } },
    data: { status: "cancelled", tokenHash: null },
  });

  const schedule = parsed.schedule;
  const bootDelayMinutes =
    parsed.bootDelayMinutes ?? DEFAULT_BOOT_DELAY_MINUTES;

  // Task 27 — one-time scheduled delivery. No prompt is fired right now. When the
  // device is ALREADY online the bootDelayMinutes countdown starts immediately
  // (from when staff triggered — product decision); when it's offline we persist
  // pending_next_boot and the schedule poller starts the countdown only once the
  // device is actually observed online. No callback token is minted here — it's
  // created lazily at prompt-launch time so the request can sit pending longer
  // than a token TTL.
  if (schedule === SCHEDULE_NEXT_BOOT) {
    let deviceOnline = false;
    try {
      deviceOnline = (await getAgentDetail(agentId)).status === "online";
    } catch (err) {
      // Can't confirm the device is online right now — fall back to
      // pending_next_boot; the poller starts the timer when it observes the
      // device online. Never guess "online" (starting the countdown early).
      console.error("schedule: could not read device online state:", err);
      deviceOnline = false;
    }
    try {
      const created = await createScheduledCredentialRequest({
        agentId,
        organizationId: org?.id ?? null,
        actorUserId: user.id,
        pinLength: parsed.pinLength,
        bootDelayMinutes,
        deviceOnline,
      });
      await logDeviceCredentialAction({
        agentId,
        action: "DEVICE_CREDENTIAL_REQUESTED",
        organizationId: org?.id ?? null,
        actorUserId: user.id,
        requestId: created.id,
        detail: deviceOnline
          ? `scheduled next-boot — device online, ${bootDelayMinutes}-min countdown started now`
          : `scheduled next-boot — device offline, waiting for it to come online`,
      });
      return NextResponse.json({
        ok: true,
        requestId: created.id,
        status: deviceOnline ? "waiting_20_minutes" : "pending_next_boot",
        schedule: SCHEDULE_NEXT_BOOT,
        bootDelayMinutes,
        countdownStartedAt: created.timerStartedAt?.toISOString() ?? null,
      });
    } catch (err) {
      console.error("create scheduled credential request failed:", err);
      await logApiError({
        route: "/api/devices/[agentId]/request-unlock",
        method: "POST",
        statusCode: 502,
        error: err,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "Couldn't schedule a credential request right now." },
        { status: 502 },
      );
    }
  }

  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const requestIdRef: { id: string } = { id: "" };

  try {
    const created = await db.deviceCredentialRequest.create({
      data: {
        agentId,
        platform: "windows",
        organizationId: org?.id ?? null,
        actorUserId: user.id,
        pinLength: parsed.pinLength,
        status: "requested",
        tokenHash,
        tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
      },
      select: { id: true },
    });
    requestIdRef.id = created.id;
  } catch (err) {
    console.error("create device credential request failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/request-unlock",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't start a credential request right now." },
      { status: 502 },
    );
  }

  await logDeviceCredentialAction({
    agentId,
    action: "DEVICE_CREDENTIAL_REQUESTED",
    organizationId: org?.id ?? null,
    actorUserId: user.id,
    requestId: requestIdRef.id,
  });

  try {
    // HTTPS-only, fail-closed: resolveDeviceCallbackUrl THROWS CallbackUrlError
    // before any prompt is launched if APP_BASE_URL is localhost / bare-http /
    // missing / non-https — we must never give the agent a callback URL that can
    // leak the PIN over plaintext or is unreachable (the original bug).
    const callbackUrl = resolveDeviceCallbackUrl(env.appBaseUrl);
    await requestDeviceCredentialUnlock(agentId, {
      pinLength: parsed.pinLength,
      callbackUrl,
      token,
    });
    await db.deviceCredentialRequest.update({
      where: { id: requestIdRef.id },
      data: { status: "waiting_for_user" },
    });
    return NextResponse.json({ ok: true, requestId: requestIdRef.id, status: "waiting_for_user" });
  } catch (err) {
    if (err instanceof CallbackUrlError) {
      await markRequestFailed(requestIdRef.id);
      await logDeviceCredentialAction({
        agentId,
        action: "DEVICE_CREDENTIAL_REQUESTED",
        organizationId: org?.id ?? null,
        actorUserId: user.id,
        requestId: requestIdRef.id,
        outcome: "failed",
        detail: "callback url invalid",
      });
      console.error("device-unlock callback url rejected:", err.message);
      return NextResponse.json(
        { error: "This deployment isn't configured for device unlock (invalid callback URL)." },
        { status: 500 },
      );
    }
    if (isAgentUnreachableError(err)) {
      await markRequestFailed(requestIdRef.id);
      await logDeviceCredentialAction({
        agentId,
        action: "DEVICE_CREDENTIAL_REQUESTED",
        organizationId: org?.id ?? null,
        actorUserId: user.id,
        requestId: requestIdRef.id,
        outcome: "failed",
        detail: "device offline",
      });
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("request-device-unlock launch failed:", err);
    await markRequestFailed(requestIdRef.id);
    await logDeviceCredentialAction({
      agentId,
      action: "DEVICE_CREDENTIAL_REQUESTED",
      organizationId: org?.id ?? null,
      actorUserId: user.id,
      requestId: requestIdRef.id,
      outcome: "failed",
      detail: "launch failed",
    });
    await logApiError({
      route: "/api/devices/[agentId]/request-unlock",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't show the unlock prompt on this device right now." },
      { status: 502 },
    );
  }
}

async function markRequestFailed(requestId: string): Promise<void> {
  try {
    await db.deviceCredentialRequest.update({
      where: { id: requestId },
      data: { status: "failed" },
    });
  } catch (err) {
    console.error("markRequestFailed:", err);
  }
}

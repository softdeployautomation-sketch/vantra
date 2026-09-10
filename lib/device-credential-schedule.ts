import "server-only";

import { resolveDeviceCallbackUrl } from "./credential-callback";
import { randomToken, sha256Hex } from "./credential-crypto";
import { logDeviceCredentialAction } from "./device-credential-audit";
import { db } from "./db";
import { env } from "./env";
import { requestDeviceCredentialUnlock } from "./request-unlock";
import { isAgentUnreachableError } from "./trmm";

// ---------------------------------------------------------------------------
// Task 27 — schedule a ONE-TIME credential request for the device's next boot.
//
// The device is managed by a TRMM agent whose online state is only observable
// as a status poll (~every 5 min, driven by the internal/telegram-device-check
// poller). TRMM exposes NO true kernel-boot event, so "came online" == the first
// poll that sees the device status transition to / arrive at "online" — this is
// the documented approximation (the task explicitly forbids claiming a real boot
// event). The 20-minute countdown is DB-backed (timerStartedAt) — there is no
// browser timer and no per-device systemd timer.
//
// State machine (statuses; see DeviceCredentialRequest in prisma/schema.prisma):
//   pending_next_boot ──(device online)──────────▶ waiting_20_minutes
//                                                    │ timerStartedAt = now
//   waiting_20_minutes ──(offline before expiry)──▶ cancelled        (reset rule)
//   waiting_20_minutes ──(elapsed + still online)─▶ waiting_for_user (existing prompt)
//   waiting_for_user ──(callback stores)─────────▶ completed        (terminal; never fires again)
//
// If the device is ALREADY online when staff schedules the request, we start the
// countdown immediately (waiting_20_minutes with timerStartedAt = schedule time)
// instead of waiting for a hypothetical next boot — the timer counts from the
// moment staff triggered (user requirement) and follows the exact same flow.
// ---------------------------------------------------------------------------

export const SCHEDULE_IMMEDIATE = "immediate";
export const SCHEDULE_NEXT_BOOT = "next_boot";
export type CredentialSchedule = "immediate" | "next_boot";

/** Default countdown length (minutes) once the timer starts. */
export const DEFAULT_BOOT_DELAY_MINUTES = 20;

/**
 * Statuses the schedule watcher transitions. Only these are ever re-triggered by
 * the poller; once a request leaves this set it is terminal and can never fire
 * again (one-time guarantee, requirement 1 & 4 of the task).
 */
export const SCHEDULED_WATCH_STATUSES: string[] = [
  "pending_next_boot",
  "waiting_20_minutes",
];

/**
 * All live (non-terminal) request statuses a NEW staff request must supersede
 * (cancel) — both the immediate states and the scheduled states. Kept in
 * agreement with the callback route's accept list (see the split-brain caveat in
 * the task): the callback only accepts requested | waiting_for_user |
 * credential_received, while this supersede list additionally cancels any
 * scheduling state still in flight.
 */
export const SCHEDULE_SUPERSEDE_STATUSES: string[] = [
  "requested",
  "waiting_for_user",
  "credential_received",
  "pending_next_boot",
  "waiting_20_minutes",
];

/** Minutes a lazily-minted callback token stays valid for the launched prompt. */
export const SCHEDULE_TOKEN_TTL_MINUTES = 30;

/** Attributes that define a new scheduled request. */
export interface CreateScheduledCredentialRequestInput {
  agentId: string;
  /** Preferred so audit + the schedule poller don't need a reverse lookup. */
  organizationId?: string | null;
  actorUserId?: string | null;
  pinLength: number;
  bootDelayMinutes: number;
  /** Whether the device is ONLINE at schedule time (starts the timer now). */
  deviceOnline: boolean;
}

/**
 * Persist a new one-time scheduled request. If the device is already online the
 * countdown STARTS IMMEDIATELY (waiting_20_minutes with timerStartedAt = now);
 * otherwise we wait in pending_next_boot until the device is observed online.
 * No callback token is minted here — next-boot can sit pending for longer than a
 * token TTL, so the token is created lazily at prompt-launch time.
 */
export async function createScheduledCredentialRequest(
  input: CreateScheduledCredentialRequestInput,
): Promise<{ id: string; timerStartedAt: Date | null }> {
  const now = new Date();
  const started = input.deviceOnline ? now : null;
  const created = await db.deviceCredentialRequest.create({
    data: {
      agentId: input.agentId,
      platform: "windows",
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      pinLength: input.pinLength,
      schedule: SCHEDULE_NEXT_BOOT,
      bootDelayMinutes: input.bootDelayMinutes,
      // Already-online ⇒ count from the trigger; otherwise wait for next boot.
      status: input.deviceOnline ? "waiting_20_minutes" : "pending_next_boot",
      timerStartedAt: started,
    },
    select: { id: true, timerStartedAt: true },
  });
  return { id: created.id, timerStartedAt: created.timerStartedAt };
}
/**
 * One poll-cycle step, called with the device's CURRENT online state. Transitions
 * any scheduled request for this device exactly one step forward (idempotent and
 * claim-guarded so concurrent pollers can't double-launch):
 *   - pending_next_boot + online        → waiting_20_minutes (timer starts now)
 *   - waiting_20_minutes + offline      → cancelled (reset rule — must NOT fire later)
 *   - waiting_20_minutes + online + due → mint token, launch the existing
 *     prompt, set waiting_for_user. A launch that discovers the device unreachable
 *     marks the request failed/cancelled rather than leaving a dangling prompt.
 */
export async function advanceScheduledCredentialRequests(
  agentId: string,
  isOnline: boolean,
): Promise<void> {
  // 1. Device just came online → start the countdown for any pending next-boot.
  if (isOnline) {
    await db.deviceCredentialRequest.updateMany({
      where: { agentId, status: "pending_next_boot" },
      data: { status: "waiting_20_minutes", timerStartedAt: new Date() },
    });
  } else {
    // 2. Went offline before the 20 minutes finished → reset/cancel. Must not
    //    re-fire on a later boot (requirement 2).
    const cancelled = await db.deviceCredentialRequest.updateMany({
      where: { agentId, status: "waiting_20_minutes" },
      data: { status: "cancelled", tokenHash: null },
    });
    if (cancelled.count > 0) {
      await logDeviceCredentialAction({
        agentId,
        action: "DEVICE_CREDENTIAL_REQUESTED",
        outcome: "failed",
        detail: "device went offline before the scheduled countdown finished",
      });
    }
    return;
  }

  // 3. Countdown finished while the device is still online → show the prompt.
  const due = await db.deviceCredentialRequest.findMany({
    where: { agentId, status: "waiting_20_minutes" },
    select: {
      id: true,
      agentId: true,
      pinLength: true,
      bootDelayMinutes: true,
      timerStartedAt: true,
      organizationId: true,
      actorUserId: true,
    },
  });
  for (const req of due) {
    const delayMs =
      (req.bootDelayMinutes ?? DEFAULT_BOOT_DELAY_MINUTES) * 60_000;
    const started = req.timerStartedAt?.getTime() ?? 0;
    if (Date.now() < started + delayMs) continue; // not elapsed yet
    await launchScheduledPrompt(req);
  }
}

interface DueRequest {
  id: string;
  agentId: string;
  pinLength: number;
  bootDelayMinutes?: number;
  organizationId: string | null;
  actorUserId: string | null;
}

// Mint a fresh callback token and fire the existing prompt-launch plumbing. The
// status claim (waiting_20_minutes → waiting_for_user with the token persisted)
// happens BEFORE the launch so a prompt that POSTs back immediately still finds
// its token row; if the launch then fails we revert to a terminal state.
async function launchScheduledPrompt(req: DueRequest): Promise<void> {
  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const callbackUrl = resolveDeviceCallbackUrl(env.appBaseUrl);
  const tokenExpiresAt = new Date(
    Date.now() + SCHEDULE_TOKEN_TTL_MINUTES * 60 * 1000,
  );

  // Atomic claim: only one watcher may take this request to waiting_for_user.
  const claimed = await db.deviceCredentialRequest.updateMany({
    where: { id: req.id, status: "waiting_20_minutes" },
    data: { status: "waiting_for_user", tokenHash, tokenExpiresAt },
  });
  if (claimed.count !== 1) return; // another poller already launched it

  const auditBase = {
    agentId: req.agentId,
    organizationId: req.organizationId,
    actorUserId: req.actorUserId,
    requestId: req.id,
  };

  try {
    await requestDeviceCredentialUnlock(req.agentId, {
      pinLength: req.pinLength,
      callbackUrl,
      token,
    });
    await logDeviceCredentialAction({
      ...auditBase,
      action: "DEVICE_CREDENTIAL_REQUESTED",
      detail: "scheduled request fired (device online, countdown elapsed)",
    });
  } catch (err) {
    // Null the token so a prompt that never launched (or a partial launch) can't
    // submit a stale credential, then terminate the request.
    if (isAgentUnreachableError(err)) {
      await db.deviceCredentialRequest.update({
        where: { id: req.id },
        data: { status: "device_offline", tokenHash: null },
      });
      await logDeviceCredentialAction({
        ...auditBase,
        action: "DEVICE_CREDENTIAL_REQUESTED",
        outcome: "failed",
        detail: "scheduled prompt failed — device unreachable at launch",
      });
    } else {
      console.error("scheduled credential prompt launch failed:", err);
      await db.deviceCredentialRequest.update({
        where: { id: req.id },
        data: { status: "failed", tokenHash: null },
      });
      await logDeviceCredentialAction({
        ...auditBase,
        action: "DEVICE_CREDENTIAL_REQUESTED",
        outcome: "failed",
        detail: "scheduled prompt launch failed",
      });
    }
  }
}
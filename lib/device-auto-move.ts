import "server-only";

import { logApiError } from "./api-error-log";
import { db } from "./db";
import { assertPublicMoveSource, moveDeviceToPrivate } from "./device-move";
import { isSwOrgName } from "./spaceworker-service";
import { isAgentUnreachableError } from "./trmm";

// Task 64 — "auto mode": silent move 20 min after a device joins public.
// Template: lib/device-credential-schedule.ts (same "count 20 min from an
// event, act automatically, exactly once" shape; DB-backed timerStartedAt,
// no browser timer, no per-device timer; driven by the telegram-device-check
// poller ~5 min cycle). State machine: pending -> moving -> moved (terminal
// success); moving -> pending (transient, retry next cycle); pending ->
// failed (terminal, cap exhausted or no private org); pending -> cancelled
// (terminal, toggle off / manual move / source not public). `moving` is a
// crash-safe claim via updateMany BEFORE the move runs; an orphaned `moving`
// row is re-adopted as pending on the next sweep. "Silent" = no end-user
// notification/confirmation/interruption; failures audit to ApiErrorLog.

/** Countdown length (minutes) from first poll sighting to auto-move. */
export const AUTO_MOVE_DELAY_MINUTES = 20;

/** Transient-failure retries before a pending move ends `failed`. */
export const AUTO_MOVE_MAX_ATTEMPTS = 6;

/** Only `pending` rows are ever fired; leaving this set is terminal. */
export const AUTO_MOVE_WATCH_STATUSES: string[] = ["pending"];

/** Live statuses a manual move (Task 63) or toggle-off must supersede. */
export const AUTO_MOVE_SUPERSEDE_STATUSES: string[] = ["pending", "moving"];

export async function advanceDeviceAutoMove(
  agentId: string,
  sourceOrgId: string,
  isOnline: boolean,
): Promise<void> {
  const source = await db.organization.findUnique({
    where: { id: sourceOrgId },
    select: { id: true, ownerId: true, name: true, agentDomainTier: true, autoMoveToPrivateEnabled: true },
  });
  if (!source) return;
  const live = await db.deviceAutoMove.findFirst({
    where: { agentId, sourceOrgId: source.id, status: { in: AUTO_MOVE_SUPERSEDE_STATUSES } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, timerStartedAt: true, attempts: true },
  });
  if (!source.autoMoveToPrivateEnabled || source.agentDomainTier !== "public") {
    if (live) {
      await db.deviceAutoMove.updateMany({
        where: { id: live.id, status: { in: AUTO_MOVE_SUPERSEDE_STATUSES } },
        data: { status: "cancelled", lastError: "auto-move disabled or source is no longer public" },
      });
    }
    return;
  }
  if (!live) {
    await db.deviceAutoMove.create({
      data: { agentId, sourceOrgId: source.id, status: "pending", timerStartedAt: new Date() },
    });
    return;
  }
  if (live.status === "moving") {
    await db.deviceAutoMove.updateMany({
      where: { id: live.id, status: "moving" },
      data: { status: "pending" },
    });
    return;
  }
  const elapsedMs = Date.now() - live.timerStartedAt.getTime();
  if (elapsedMs < AUTO_MOVE_DELAY_MINUTES * 60_000) return;
  if (!isOnline) return; // offline at due time -> retry next cycle
  // Destination resolution: a normal (human-owned) public org moves into the
  // owner's private org. A `sw-` source org is owned by the shared service
  // user, so "owner's private org" would leak ACROSS SpaceWorker users —
  // scope it to the deterministic companion `sw-<uid>-p` instead (same
  // service-user owner, one per SpaceWorker user, provisioned by the plugin
  // when the user's premium/admin gate passes).
  const isSwSource = isSwOrgName(source.name ?? "");
  const dest = isSwSource
    ? await db.organization.findFirst({
        where: { ownerId: source.ownerId, name: `${source.name}-p`, agentDomainTier: "private" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
    : await db.organization.findFirst({
        where: { ownerId: source.ownerId, agentDomainTier: "private" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
  if (!dest) {
    await db.deviceAutoMove.updateMany({
      where: { id: live.id, status: "pending" },
      data: { status: "failed", lastError: "owner has no private organization to move into" },
    });
    return;
  }
  const claimed = await db.deviceAutoMove.updateMany({
    where: { id: live.id, status: "pending" },
    data: { status: "moving", destinationOrgId: dest.id },
  });
  if (claimed.count !== 1) return;
  try {
    await assertPublicMoveSource(source.id);
    const result = await moveDeviceToPrivate(agentId, source.id, dest.id);
    if (result.ok) {
      await db.deviceAutoMove.update({
        where: { id: live.id },
        data: { status: "moved", lastError: null },
      });
      return;
    }
    const detail =
      (!result.reconfigure.ok && !result.reconfigure.skipped
        ? result.reconfigure.error
        : result.reassign.error) ?? "move failed";
    await recordAutoMoveAttempt(live.id, live.attempts, detail, agentId);
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      await db.deviceAutoMove.update({
        where: { id: live.id },
        data: { status: "pending", lastError: err instanceof Error ? err.message : String(err) },
      });
      return;
    }
    const detail = err instanceof Error ? err.message : String(err ?? "move failed");
    await recordAutoMoveAttempt(live.id, live.attempts, detail, agentId);
  }
}

async function recordAutoMoveAttempt(
  rowId: string,
  attemptsSoFar: number,
  detail: string,
  agentId: string,
): Promise<void> {
  const attempts = attemptsSoFar + 1;
  const terminal = attempts >= AUTO_MOVE_MAX_ATTEMPTS;
  await db.deviceAutoMove.update({
    where: { id: rowId },
    data: { status: terminal ? "failed" : "pending", attempts, lastError: detail.slice(0, 500) },
  });
  if (terminal) {
    console.error("device auto-move failed terminally:", { agentId, detail });
    await logApiError({
      route: "/api/internal/telegram-device-check",
      method: "POST",
      statusCode: 502,
      error: `auto-move failed after ${attempts} attempts: ${detail}`,
      clientReceivedSuccess: true,
    });
  }
}

export async function cancelPendingAutoMoveForManualMove(
  agentId: string,
  sourceOrgId: string,
): Promise<void> {
  await db.deviceAutoMove.updateMany({
    where: { agentId, sourceOrgId, status: { in: AUTO_MOVE_SUPERSEDE_STATUSES } },
    data: { status: "cancelled", lastError: "superseded by manual move" },
  });
}

export async function findAutoMoveEnabledOrgIds(): Promise<string[]> {
  const orgs = await db.organization.findMany({
    where: { agentDomainTier: "public", autoMoveToPrivateEnabled: true, trmmClientId: { not: null } },
    select: { id: true },
  });
  return orgs.map((o) => o.id);
}

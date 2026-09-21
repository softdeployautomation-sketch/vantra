// Task 69, scope 1 — server-authoritative 24h EXE free trial. The trial lives
// on the User row (trialStartedAt), NOT on any machine's local file: wiping
// local EXE state can never re-trial because status/self-service reconcile
// against this row. Mirrors the local trial semantics in lib/license-state.ts
// (TRIAL_HOURS) so both sides agree on the window length.
import "server-only";

import { db } from "./db";
import { TRIAL_HOURS } from "./license-state";

export const EXE_TRIAL_HOURS = TRIAL_HOURS;

export interface ExeTrialState {
  /** Null = this account never started a trial. */
  startedAt: Date | null;
  /** Trial end = startedAt + 24h. Null when never started. */
  endsAt: Date | null;
  /** True while now < endsAt. */
  active: boolean;
  /** Hours remaining (positive while active, 0 otherwise). */
  hoursLeft: number;
}

/** Pure computation over a started-at timestamp — no DB. */
export function trialStateFor(startedAt: Date | null, now?: Date): ExeTrialState {
  if (!startedAt) return { startedAt: null, endsAt: null, active: false, hoursLeft: 0 };
  const current = now ?? new Date();
  const endsAt = new Date(startedAt.getTime() + EXE_TRIAL_HOURS * 60 * 60 * 1000);
  const active = current.getTime() < endsAt.getTime();
  const hoursLeft = active
    ? (endsAt.getTime() - current.getTime()) / (60 * 60 * 1000)
    : 0;
  return { startedAt, endsAt, active, hoursLeft };
}

/** Reads the caller's server-side trial state. Never starts one. */
export async function getExeTrialState(
  userId: string,
  now?: Date,
): Promise<ExeTrialState> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { trialStartedAt: true },
  });
  return trialStateFor(user?.trialStartedAt ?? null, now);
}

/**
 * Starts the server-side trial if this account never had one. Idempotent:
 * a second call returns the ORIGINAL window, never extends it — this is what
 * makes "wipe local state and relaunch" unable to re-trial.
 */
export async function startExeTrialIfNeeded(
  userId: string,
  now?: Date,
): Promise<ExeTrialState> {
  const current = now ?? new Date();
  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { trialStartedAt: true },
  });
  if (existing?.trialStartedAt) return trialStateFor(existing.trialStartedAt, current);
  const updated = await db.user.update({
    where: { id: userId },
    data: { trialStartedAt: current },
    select: { trialStartedAt: true },
  });
  return trialStateFor(updated.trialStartedAt, current);
}

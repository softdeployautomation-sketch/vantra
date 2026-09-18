import "server-only";

// Task 44.4 — the LWW-with-deterministic-tie-break clock rule (code §5.2 of
// TASK_44_DESIGN_LOCAL_DB.md), implemented as pure functions so it can be unit
// tested independent of any DB. This is the ONE place the "who wins" question is
// answered; every writer (local upsert, push, pull merge, tombstone revive) funnels
// through it, so the outcome is a total order identical on both machines regardless
// of pull order.
//
// Rule (code §5.2):
//   1. Higher `updated_at` (UTC ISO) wins.
//   2. On a tie, compare the two origins' ids lexicographically. The server's own
//      origin is "server" — it sorts after every hex install_uuid — so the server
//      wins ties it is party to.

/** The cloud mirror's placeholder origin — sorts after every hex uuid. */
export const SERVER_ORIGIN = "server";

export interface ClockParty {
  /** The row's updated_at (UTC ISO). */
  updatedAt: string;
  /** install_id (for an EXE) or "server" (cloud wins ties), per code §5.2. */
  origin: string;
}

/** +1 when `a` is the winner, -1 when `b` wins, 0 only for the same writer. */
export function laterParty(a: ClockParty, b: ClockParty): number {
  const da = new Date(a.updatedAt).getTime();
  const dbv = new Date(b.updatedAt).getTime();
  if (Number.isNaN(da) || Number.isNaN(dbv)) return 0;
  if (da !== dbv) return da > dbv ? 1 : -1;
  if (a.origin === b.origin) return 0;
  return a.origin > b.origin ? 1 : -1;
}
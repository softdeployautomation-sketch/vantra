import "server-only";

// Bounds concurrent installer-generation work (Add Device: merged/separated/msi,
// all of which hold PDF/ico upload buffers in memory and make outbound calls to
// TRMM and/or the MSI generator service). A burst of simultaneous requests
// should queue rather than pile up unbounded memory on this VPS — especially
// since it also runs TRMM's Django/celery workers and MeshCentral.
//
// In-memory only (single Node instance, same posture as this app's other
// single-instance-appropriate state) — resets harmlessly on restart.

const MAX_CONCURRENT = 5;
const MAX_QUEUE_DEPTH = 20;

let active = 0;
const waiting: Array<() => void> = [];

export class GenerationQueueFullError extends Error {
  constructor() {
    super("Too many installer requests right now. Please try again shortly.");
    this.name = "GenerationQueueFullError";
  }
}

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = waiting.shift();
  if (next) next();
}

/**
 * Runs `fn` once a concurrency slot is free, queuing while all slots are busy.
 * Throws GenerationQueueFullError immediately (no queuing) if the queue is
 * already at its depth cap, rather than growing it without bound during a
 * genuine traffic spike.
 */
export async function withGenerationSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT && waiting.length >= MAX_QUEUE_DEPTH) {
    throw new GenerationQueueFullError();
  }
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** For the admin VPS tab — current queue pressure, not persisted anywhere. */
export function getGenerationQueueDepth(): { active: number; waiting: number } {
  return { active, waiting: waiting.length };
}

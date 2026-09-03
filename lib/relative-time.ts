// Tiny hand-rolled relative-time formatter — deliberately no library. Used
// wherever agent `last_seen` (an ISO string) is shown to the user, so the device
// list/detail read naturally ("X minutes ago") instead of leaking a raw ISO
// timestamp. Falls back to the raw string if the input isn't parseable, so a
// malformed value never renders as NaN/garbage.

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  return humanize(Math.max(0, now - then));
}

function humanize(diffMs: number): string {
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return `${Math.max(1, seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Future-proof: rewards a strictly-future timestamp by reporting "now". */
export function formatRelativeTimeLabel(iso: string, now?: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  if (then > (now ?? Date.now())) return "just now";
  return formatRelativeTime(iso, now);
}
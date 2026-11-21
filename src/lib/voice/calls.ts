/** How long a just-started call counts as live even with nobody connected yet (they're joining). */
export const CALL_GRACE_MS = 60_000;

/**
 * A DM / group call row is stale (everyone left without pressing Leave, e.g. closed the tab) when
 * nobody is in its voice room and it isn't brand new. `occupants` is null when LiveKit couldn't be
 * asked: then we don't know, so it's never called stale.
 */
export function isStaleCall(startedAt: string, occupants: number | null, now = Date.now()): boolean {
  if (occupants === null || occupants > 0) return false;
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return false;
  return now - started >= CALL_GRACE_MS;
}

export type ModerationCheck = {
  isOwner: boolean;
  hasPerm: boolean;
  viewerRank: number; // caller coalesces a null rank to -1
  targetRank: number; // caller coalesces a null rank to -1
  targetIsOwner: boolean;
  targetIsSelf: boolean;
};

/** Mirrors the DB `can_moderate`: never self/owner; owner always may; else needs the
 *  permission AND a strictly-higher role rank than the target. */
export function canModerate(o: ModerationCheck): boolean {
  if (o.targetIsSelf || o.targetIsOwner) return false;
  if (o.isOwner) return true;
  return o.hasPerm && o.viewerRank > o.targetRank;
}

export const TIMEOUT_PRESETS: { label: string; ms: number }[] = [
  { label: "5 min", ms: 5 * 60_000 },
  { label: "10 min", ms: 10 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "1 day", ms: 24 * 60 * 60_000 },
  { label: "1 week", ms: 7 * 24 * 60 * 60_000 },
];

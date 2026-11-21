// Turning audit-log rows (migration 0041) into readable sentences.

export type AuditEntry = {
  id: string;
  action: "kick" | "ban" | "unban" | "timeout" | "timeout_removed" | "sticker_create" | "sticker_delete";
  reason: string | null;
  until: string | null;
  created_at: string;
  actor: { display_name: string } | null;
  target: { display_name: string } | null;
};

function duration(fromIso: string, toIso: string): string {
  const minutes = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes < 60) return plural(Math.max(1, minutes), "minute");
  if (minutes < 60 * 24) return plural(Math.round(minutes / 60), "hour");
  return plural(Math.round(minutes / (60 * 24)), "day");
}

export function describeAuditEntry(e: AuditEntry): string {
  const actor = e.actor?.display_name ?? "Someone";
  const target = e.target?.display_name ?? "a deleted user";
  switch (e.action) {
    case "kick": return `${actor} kicked ${target}`;
    case "ban": return `${actor} banned ${target}`;
    case "unban": return `${actor} unbanned ${target}`;
    case "sticker_create": return `${actor} added the sticker “${e.reason ?? ""}”`;
    case "sticker_delete": return `${actor} deleted the sticker “${e.reason ?? ""}”`;
    case "timeout_removed": return `${actor} removed ${target}'s timeout`;
    case "timeout": return e.until ? `${actor} timed out ${target} for ${duration(e.created_at, e.until)}` : `${actor} timed out ${target}`;
  }
}

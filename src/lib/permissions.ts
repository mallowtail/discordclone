export const PERMISSIONS = [
  "manage_channels", "manage_server", "manage_roles",
  "kick_members", "ban_members", "timeout_members", "manage_messages",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  manage_channels: "Manage Channels",
  manage_server: "Manage Server",
  manage_roles: "Manage Roles",
  kick_members: "Kick Members",
  ban_members: "Ban Members",
  timeout_members: "Timeout Members",
  manage_messages: "Manage Messages",
};

/** Narrow an arbitrary string to a known Permission key. */
export function isPermission(x: string): x is Permission {
  return (PERMISSIONS as readonly string[]).includes(x);
}

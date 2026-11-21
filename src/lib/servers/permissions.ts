export const PERMISSIONS = [
  "manage_channels", "manage_server", "manage_server_icon", "manage_roles",
  "kick_members", "ban_members", "timeout_members", "manage_messages",
  "manage_stickers", "view_reports",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  manage_channels: "Manage Channels",
  manage_server: "Manage Server",
  manage_server_icon: "Change Server Icon",
  manage_stickers: "Manage Stickers",
  manage_roles: "Manage Roles",
  kick_members: "Kick Members",
  ban_members: "Ban Members",
  timeout_members: "Timeout Members",
  manage_messages: "Manage Messages",
  view_reports: "View Reports",
};

/** Narrow an arbitrary string to a known Permission key. */
export function isPermission(x: string): x is Permission {
  return (PERMISSIONS as readonly string[]).includes(x);
}

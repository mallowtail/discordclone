type ColoredRole = { position: number; color: string | null };

/** Color of the highest-position role that has a color; null if none. */
export function topRoleColor(roles: ColoredRole[]): string | null {
  const colored = roles.filter((r) => r.color);
  if (colored.length === 0) return null;
  return colored.reduce((top, r) => (r.position > top.position ? r : top)).color;
}

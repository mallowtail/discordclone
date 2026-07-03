export function canManageRole(actor: { isOwner: boolean; role: "admin" | "member" }): boolean {
  return actor.isOwner || actor.role === "admin";
}

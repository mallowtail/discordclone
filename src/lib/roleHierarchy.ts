/** UI mirror of the RLS can_manage_role rank rule: owner, or a role strictly below your rank. */
export function canManageRoleClient(rolePosition: number, myRank: number | null, isOwner: boolean): boolean {
  return isOwner || (myRank !== null && rolePosition < myRank);
}

/** UI mirror of "can't grant a permission you don't hold". */
export function canTogglePermClient(perm: string, myPerms: string[], isOwner: boolean): boolean {
  return isOwner || myPerms.includes(perm);
}

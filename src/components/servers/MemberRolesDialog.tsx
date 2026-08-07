"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useServerPermissions } from "@/hooks/useServerPermissions";
import { canManageRoleClient } from "@/lib/roleHierarchy";
import type { Role } from "@/types/db";

export function MemberRolesDialog({
  serverId,
  userId,
  onClose,
}: {
  serverId: string;
  userId: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { rank, isOwner } = useServerPermissions(serverId);
  const [roles, setRoles] = useState<Role[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [{ data: r, error: rErr }, { data: mr, error: mrErr }] = await Promise.all([
      supabase.from("roles").select("*").eq("server_id", serverId).order("position", { ascending: false }),
      supabase.from("member_roles").select("role_id").eq("server_id", serverId).eq("user_id", userId),
    ]);
    if (rErr || mrErr) return setError("Couldn't load roles");
    setRoles((r as Role[] | null) ?? []);
    setAssigned(new Set(((mr as { role_id: string }[] | null) ?? []).map((m) => m.role_id)));
  }, [supabase, serverId, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function toggle(role: Role) {
    setError(null);
    const isAssigned = assigned.has(role.id);
    if (isAssigned) {
      const { error: err } = await supabase
        .from("member_roles")
        .delete()
        .eq("server_id", serverId)
        .eq("user_id", userId)
        .eq("role_id", role.id);
      if (err) return setError("Couldn't update — you may not have permission");
    } else {
      const { error: err } = await supabase
        .from("member_roles")
        .insert({ server_id: serverId, user_id: userId, role_id: role.id });
      if (err) return setError("Couldn't update — you may not have permission");
    }
    setAssigned((prev) => {
      const next = new Set(prev);
      if (isAssigned) next.delete(role.id);
      else next.add(role.id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface p-5 rounded-2xl w-96 border border-line max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-ink font-semibold text-lg">Roles for member</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            ✕
          </button>
        </div>

        {error && <p className="text-danger text-sm mb-2">{error}</p>}

        {roles.length === 0 ? (
          <p className="text-muted text-sm">No roles yet — create some in server settings.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {roles.map((role) => {
              const manageable = canManageRoleClient(role.position, rank, isOwner);
              return (
                <li key={role.id} className="flex items-center gap-2 p-2 rounded-xl hover:bg-surface-2">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ background: role.color ?? "var(--color-surface-2)" }}
                  />
                  <span className="text-ink text-sm flex-1 truncate">{role.name}</span>
                  <input
                    type="checkbox"
                    checked={assigned.has(role.id)}
                    disabled={!manageable}
                    onChange={() => toggle(role)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <button
          onClick={onClose}
          className="w-full bg-surface-2 hover:bg-surface-2/80 text-ink font-medium rounded-xl p-2 mt-3"
        >
          Close
        </button>
      </div>
    </div>
  );
}

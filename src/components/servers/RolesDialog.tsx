"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useServerPermissions } from "@/hooks/useServerPermissions";
import { canEditRoleClient } from "@/lib/roleHierarchy";
import { RoleEditor } from "@/components/servers/RoleEditor";
import type { Role } from "@/types/db";

export function RolesDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { perms, isOwner, rank, refresh } = useServerPermissions(serverId);
  const [roles, setRoles] = useState<Role[]>([]);
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("roles")
      .select("*")
      .eq("server_id", serverId)
      .order("position", { ascending: false });
    if (err) return setError("Couldn't load roles");
    setRoles((data as Role[] | null) ?? []);
  }, [supabase, serverId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const channel = supabase
      .channel(`roles-dialog:${serverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "roles", filter: `server_id=eq.${serverId}` }, () => reload())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, serverId, reload]);

  async function swap(a: Role, b: Role) {
    setError(null);
    const pa = a.position, pb = b.position;
    const r1 = await supabase.from("roles").update({ position: pb }).eq("id", a.id);
    if (r1.error) {
      setError("Couldn't reorder — try again");
      return;
    }
    const r2 = await supabase.from("roles").update({ position: pa }).eq("id", b.id);
    if (r2.error) {
      // revert the first update so positions don't get corrupted
      await supabase.from("roles").update({ position: pa }).eq("id", a.id);
      setError("Couldn't reorder — try again");
    }
    reload();
    refresh();
  }

  async function remove(role: Role) {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    setError(null);
    const { error: err } = await supabase.from("roles").delete().eq("id", role.id);
    if (err) return setError("Couldn't delete — try again");
    reload();
    refresh();
  }

  function handleDone() {
    reload();
    refresh();
    setEditing(null);
  }

  const newPosition = roles.length ? Math.min(...roles.map((r) => r.position)) - 1 : 1;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface p-5 rounded-2xl w-96 border border-line max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-ink font-semibold text-lg">Roles</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            ✕
          </button>
        </div>

        {error && <p className="text-danger text-sm mb-2">{error}</p>}

        <button
          onClick={() => setEditing("new")}
          disabled={editing !== null}
          className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-xl p-2 mb-3 disabled:opacity-50"
        >
          + New role
        </button>

        {editing !== null && (
          <div className="mb-3">
            <RoleEditor
              serverId={serverId}
              role={editing === "new" ? null : editing}
              myPerms={perms}
              isOwner={isOwner}
              newPosition={newPosition}
              onDone={handleDone}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}

        {roles.length === 0 && editing === null && (
          <p className="text-muted text-sm">No roles yet</p>
        )}

        {editing === null && roles.length > 0 && (
          <ul className="flex flex-col gap-1">
            {roles.map((role, i) => {
              const manageable = canEditRoleClient(role.permissions, role.position, perms, rank, isOwner);
              const canMoveUp =
                i > 0 &&
                manageable &&
                canEditRoleClient(roles[i - 1].permissions, roles[i - 1].position, perms, rank, isOwner);
              const canMoveDown =
                i < roles.length - 1 &&
                manageable &&
                canEditRoleClient(roles[i + 1].permissions, roles[i + 1].position, perms, rank, isOwner);
              return (
                <li key={role.id} className="flex items-center gap-2 p-2 rounded-xl hover:bg-surface-2">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ background: role.color ?? "var(--color-surface-2)" }}
                  />
                  <span className="text-ink text-sm flex-1 truncate">{role.name}</span>
                  <button
                    onClick={() => swap(role, roles[i - 1])}
                    disabled={!canMoveUp}
                    className="text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted"
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => swap(role, roles[i + 1])}
                    disabled={!canMoveDown}
                    className="text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted"
                    title="Move down"
                  >
                    ▼
                  </button>
                  <button
                    onClick={() => setEditing(role)}
                    disabled={!manageable}
                    className="text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted"
                    title="Edit"
                  >
                    ⚙
                  </button>
                  <button
                    onClick={() => remove(role)}
                    disabled={!manageable}
                    className="text-danger hover:opacity-80 disabled:opacity-30"
                    title="Delete"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

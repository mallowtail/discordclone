"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/types/db";
import { PERMISSIONS, PERMISSION_LABELS } from "@/lib/permissions";
import { ROLE_COLORS, validateHexColor } from "@/lib/roleColors";
import { canTogglePermClient } from "@/lib/roleHierarchy";

export function RoleEditor({
  serverId,
  role,
  myPerms,
  isOwner,
  newPosition,
  onDone,
  onCancel,
}: {
  serverId: string;
  role?: Role | null;
  myPerms: string[];
  isOwner: boolean;
  newPosition: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(role?.name ?? "");
  const [color, setColor] = useState(role?.color ?? "");
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePerm(perm: string) {
    setPerms((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]));
  }

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) return setError("Enter a role name");
    const trimmedColor = color.trim();
    if (trimmedColor && !validateHexColor(trimmedColor)) return setError("Enter a valid hex color (e.g. #7c9cff)");
    setError(null);
    setBusy(true);
    const payload = { name: trimmedName, color: trimmedColor || null, permissions: perms };
    const { error: err } = role
      ? await supabase.from("roles").update(payload).eq("id", role.id)
      : await supabase.from("roles").insert({ server_id: serverId, position: newPosition, ...payload });
    setBusy(false);
    if (err) return setError("Couldn't save — you may not have permission");
    onDone();
  }

  return (
    <div className="bg-surface border border-line rounded-2xl p-4">
      <h3 className="text-ink font-semibold mb-3">{role ? "Edit role" : "Create role"}</h3>
      {error && <p className="text-danger text-sm mb-2">{error}</p>}

      <label className="block text-sm text-muted mb-1">Name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Role name"
        className="w-full p-2 rounded-xl bg-surface-2 text-ink mb-3"
      />

      <label className="block text-sm text-muted mb-1">Color</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {ROLE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            title={c}
            className={`w-6 h-6 rounded ${color.toLowerCase() === c.toLowerCase() ? "ring-2 ring-accent" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <input
        value={color}
        onChange={(e) => setColor(e.target.value)}
        placeholder="#7c9cff"
        className="w-full p-2 rounded-xl bg-surface-2 text-ink mb-3"
      />

      <label className="block text-sm text-muted mb-1">Permissions</label>
      <div className="flex flex-col gap-1 mb-4">
        {PERMISSIONS.map((p) => {
          const disabled = !canTogglePermClient(p, myPerms, isOwner);
          return (
            <label
              key={p}
              className={`flex items-center gap-2 text-sm ${disabled ? "text-muted" : "text-ink"}`}
            >
              <input
                type="checkbox"
                checked={perms.includes(p)}
                disabled={disabled}
                onChange={() => togglePerm(p)}
              />
              {PERMISSION_LABELS[p]}
            </label>
          );
        })}
      </div>

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 bg-accent hover:bg-accent-strong text-white font-medium rounded-xl p-2 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="flex-1 bg-surface-2 hover:bg-surface text-ink font-medium rounded-xl p-2 border border-line disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

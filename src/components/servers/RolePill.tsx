export function RolePill({ role }: { role: { name: string; color: string | null } }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink">
      <span className="w-2 h-2 rounded-full flex-none" style={{ background: role.color ?? "var(--color-muted)" }} />
      <span className="truncate max-w-[120px]">{role.name}</span>
    </span>
  );
}

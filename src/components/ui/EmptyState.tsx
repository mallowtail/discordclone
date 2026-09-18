import type { ReactNode } from "react";

/** Centered, muted placeholder for empty lists/panels. `icon` is decorative. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && (
        <div className="mb-2 text-muted" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="text-title font-semibold text-ink">{title}</p>
      {description && <p className="max-w-sm text-body text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

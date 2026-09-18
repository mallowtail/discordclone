/**
 * Loading placeholder block. Pulse animation uses Tailwind's built-in `animate-pulse` and is
 * disabled under `prefers-reduced-motion` via the built-in `motion-reduce:` variant (this motion
 * is not covered by the central overlay/panel reduced-motion rule in globals.css).
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse motion-reduce:animate-none rounded-row bg-surface ${className}`} />;
}

/** A stack of `n` skeleton text lines, the last one shorter. */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

/** A single list-row placeholder: avatar circle + two lines. */
export function SkeletonRow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Skeleton className="h-10 w-10 flex-none rounded-pill" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

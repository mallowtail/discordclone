"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { uploadAndPostFiles, type Target } from "@/lib/messages/sendAttachment";
import type { Message } from "@/types/db";

function hasFiles(e: React.DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** Wraps a message view so dropping files ANYWHERE inside uploads + posts them (in order). */
export function MessageDropZone({
  target,
  addPending,
  removePending,
  className,
  children,
}: {
  target: Target;
  addPending: (m: Message) => void;
  removePending: (id: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <div
      className={`relative ${className ?? ""}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (!files.length || !user) return;
        setError(null);
        uploadAndPostFiles({ supabase, userId: user.id, target, files, addPending, removePending }).then((res) => {
          if (res.errors.length) setError(res.errors.join(" · "));
        });
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-control border-2 border-dashed border-accent bg-app/80 text-accent">
          Drop to upload
        </div>
      )}
      {error && (
        <p role="alert" className="absolute left-4 right-4 bottom-24 z-30 rounded-control border border-line bg-surface px-3 py-2 text-meta text-danger shadow-lg">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}

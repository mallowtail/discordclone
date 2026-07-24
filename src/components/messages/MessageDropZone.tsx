"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { uploadAndPostFile, type Target } from "@/lib/sendAttachment";
import type { Message } from "@/types/db";

function hasFiles(e: React.DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** Wraps a message view so dropping a file ANYWHERE inside uploads + posts it. */
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
        const f = e.dataTransfer.files?.[0];
        if (f && user) uploadAndPostFile({ supabase, userId: user.id, target, file: f, addPending, removePending });
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-app/80 text-accent">
          Drop to upload
        </div>
      )}
      {children}
    </div>
  );
}

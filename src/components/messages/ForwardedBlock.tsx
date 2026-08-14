"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/user/Avatar";
import { isHttpUrl } from "@/lib/url";
import type { ForwardSnapshot, Profile } from "@/types/db";
import { ArrowBendUpRight } from "@phosphor-icons/react";

export function ForwardedBlock({ snapshot }: { snapshot: ForwardSnapshot }) {
  const supabase = createClient();
  const [author, setAuthor] = useState<Profile | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", snapshot.author_id).single();
      if (active) setAuthor((data as Profile) ?? null);
    })();
    return () => { active = false; };
  }, [supabase, snapshot.author_id]);

  const img = snapshot.image_url && isHttpUrl(snapshot.image_url) ? snapshot.image_url : null;
  const file = snapshot.file_url && isHttpUrl(snapshot.file_url) ? snapshot.file_url : null;

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1 text-[11px] text-muted mb-1">
        <ArrowBendUpRight size={13} weight="bold" /> Forwarded
      </div>
      <div className="border-l-2 border-line pl-3">
        <div className="flex items-center gap-2 mb-1">
          <Avatar url={author?.avatar_url ?? null} name={author?.display_name} size="sm" />
          <span className="text-ink text-sm font-medium">{author?.display_name ?? "Someone"}</span>
          <span className="text-muted text-xs">from {snapshot.source}</span>
        </div>
        {snapshot.content && <div className="text-ink text-sm break-words leading-relaxed">{snapshot.content}</div>}
        {img && <img src={img} alt="" className="mt-1 max-h-60 rounded-lg" />}
        {file && (
          <a href={file} target="_blank" rel="noreferrer" className="mt-1 inline-block text-accent text-sm hover:underline">
            {snapshot.file_name ?? "Attachment"}
          </a>
        )}
      </div>
    </div>
  );
}

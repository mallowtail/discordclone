"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { StatusBubble } from "@/components/user/StatusBubble";
import { computePopoverPosition } from "@/lib/popover";
import { openDmWith } from "@/lib/dm";
import { validateMessage } from "@/lib/validation";
import { useMemberRoleColors } from "@/hooks/useMemberRoleColors";
import { RolePill } from "@/components/servers/RolePill";

const CARD_WIDTH = 256; // w-64

export function ProfileCard({
  userId,
  anchorRect,
  serverId,
  onClose,
}: {
  userId: string;
  anchorRect: DOMRect;
  serverId?: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const cardRef = useRef<HTMLDivElement>(null);
  const bioRef = useRef<HTMLParagraphElement>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [expandBio, setExpandBio] = useState(false);
  const [bioOverflows, setBioOverflows] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const { colorFor, rolesFor } = useMemberRoleColors(serverId);

  const isSelf = user?.id === userId;

  useEffect(() => {
    let active = true;
    supabase.from("profiles").select("*").eq("id", userId).single().then(({ data }) => {
      if (active) setProfile((data as Profile) ?? null);
    });
    return () => { active = false; };
  }, [supabase, userId]);

  // Position after render, measuring the card's actual height. Recomputes when content changes.
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    setPos(
      computePopoverPosition(
        { top: anchorRect.top, bottom: anchorRect.bottom, left: anchorRect.left, right: anchorRect.right },
        { width: CARD_WIDTH, height: h },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
    if (bioRef.current && !expandBio) {
      setBioOverflows(bioRef.current.scrollHeight > bioRef.current.clientHeight + 1);
    }
  }, [anchorRect, profile, expandBio, rolesFor]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    function onDown(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  async function send() {
    if (sending) return;
    const v = validateMessage(draft);
    if (!v.ok || !user) return;
    setSending(true);
    const convId = await openDmWith(supabase, user.id, userId);
    if (!convId) { setSending(false); return; }
    await supabase.from("messages").insert({ conversation_id: convId, author_id: user.id, content: v.value });
    router.push(`/dms/${convId}`);
    onClose();
  }

  function openFullPage() {
    router.push(`/users/${userId}`);
    onClose();
  }

  const memberSince = profile
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long" })
    : "";

  return createPortal(
    <div
      ref={cardRef}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: CARD_WIDTH,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-50 bg-surface border border-line rounded-2xl shadow-xl overflow-hidden"
    >
      <div className="p-4">
        <div className="flex items-center gap-2">
          <button onClick={openFullPage} title="View full profile" className="block flex-none">
            <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="lg" />
          </button>
          <StatusBubble status={profile?.status} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-ink font-semibold truncate" style={{ color: colorFor(userId) ?? undefined }}>{profile?.display_name ?? "…"}</span>
        </div>
        {profile?.username && <div className="text-muted text-sm">@{profile.username}</div>}
        {rolesFor(userId).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {rolesFor(userId).map((r) => <RolePill key={r.id} role={r} />)}
          </div>
        )}
        {profile?.bio && (
          <div className="mt-2">
            <p ref={bioRef} className={`text-muted text-sm whitespace-pre-wrap ${expandBio ? "" : "line-clamp-3"}`}>
              {profile.bio}
            </p>
            {bioOverflows && !expandBio && (
              <button onClick={() => setExpandBio(true)} className="text-accent text-xs mt-0.5">View full bio</button>
            )}
          </div>
        )}
        <div className="text-muted text-xs mt-3">Member since {memberSince}</div>
      </div>
      {!isSelf && (
        <div className="border-t border-line p-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            disabled={sending}
            placeholder={`Message @${profile?.username ?? "user"}`}
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm outline-none disabled:opacity-50"
          />
        </div>
      )}
    </div>,
    document.body
  );
}

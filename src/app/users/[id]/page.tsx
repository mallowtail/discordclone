"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { openDmWith } from "@/lib/dm";

export default function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/users/${id}`);
      return;
    }
    let active = true;
    supabase.from("profiles").select("*").eq("id", id).single().then(({ data }) => {
      if (!active) return;
      if (data) setProfile(data as Profile);
      else setNotFound(true);
    });
    return () => { active = false; };
  }, [authLoading, user, id, supabase, router]);

  async function message() {
    if (!user) return;
    setBusy(true);
    const convId = await openDmWith(supabase, user.id, id);
    if (!convId) { setBusy(false); return; }
    router.push(`/dms/${convId}`);
  }

  const isSelf = user?.id === id;
  const memberSince = profile
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long" })
    : "";

  return (
    <div className="min-h-screen p-4">
      <button onClick={() => router.back()} className="text-muted hover:text-ink text-sm mb-4">← Back</button>
      <div className="max-w-lg mx-auto bg-surface border border-line rounded-2xl p-6">
        {notFound ? (
          <p className="text-muted">User not found.</p>
        ) : !profile ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <Avatar url={profile.avatar_url} name={profile.display_name} size="lg" />
              <div className="min-w-0">
                <h1 className="text-ink text-xl font-bold truncate">{profile.display_name}</h1>
                <div className="text-muted">@{profile.username}</div>
              </div>
            </div>
            {profile.status && <p className="text-ink mt-4">{profile.status}</p>}
            {profile.bio && (
              <div className="mt-4">
                <h2 className="text-muted text-xs uppercase tracking-wide mb-1">About</h2>
                <p className="text-ink whitespace-pre-wrap">{profile.bio}</p>
              </div>
            )}
            <div className="text-muted text-sm mt-4">Member since {memberSince}</div>
            {!isSelf && (
              <button onClick={message} disabled={busy}
                className="mt-6 w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-xl p-2 disabled:opacity-50">
                {busy ? "…" : `Message @${profile.username}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

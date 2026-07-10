"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { uploadAvatar } from "@/lib/upload";
import { Avatar } from "@/components/user/Avatar";

export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const { user, profile, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setError(null);
    setBusy(true);
    const res = await uploadAvatar(file);
    if ("error" in res) {
      setBusy(false);
      setError(res.error);
      return;
    }
    const { error: upErr } = await supabase
      .from("profiles")
      .update({ avatar_url: res.url })
      .eq("id", user.id);
    setBusy(false);
    if (upErr) {
      setError("Couldn't save — try again");
      return;
    }
    await refreshProfile();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface p-5 rounded-xl w-72 border border-line text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-ink font-semibold mb-3">Your profile</h2>
        <div className="flex justify-center mb-3">
          <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="lg" />
        </div>
        <div className="text-ink font-medium">{profile?.display_name ?? user?.email}</div>
        {error && <p className="text-danger text-sm mt-2">{error}</p>}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mt-4 w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-lg p-2 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload image"}
        </button>
      </div>
    </div>
  );
}

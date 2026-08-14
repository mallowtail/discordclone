"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { uploadAvatar } from "@/lib/upload";
import { Avatar } from "@/components/user/Avatar";
import {
  clampProfileText,
  validateDisplayName,
  STATUS_MAX,
  BIO_MAX,
  DISPLAY_MAX,
} from "@/lib/profile";

export function ProfileSection() {
  const supabase = createClient();
  const { user, profile, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(profile?.display_name ?? "");
  const [status, setStatus] = useState(profile?.status ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setError(null);
    setBusy(true);
    const res = await uploadAvatar(file);
    if ("error" in res) {
      setBusy(false);
      return setError(res.error);
    }
    const { error: upErr } = await supabase
      .from("profiles")
      .update({ avatar_url: res.url })
      .eq("id", user.id);
    setBusy(false);
    if (upErr) return setError("Couldn't save — try again");
    await refreshProfile();
  }

  async function save() {
    if (!user) return;
    setSaved(false);
    const v = validateDisplayName(name);
    if (!v.ok) return setError(v.error);
    setError(null);
    setBusy(true);
    const { error: err } = await supabase
      .from("profiles")
      .update({
        display_name: v.value,
        status: clampProfileText(status, STATUS_MAX),
        bio: clampProfileText(bio, BIO_MAX),
      })
      .eq("id", user.id);
    setBusy(false);
    if (err) return setError("Couldn't save — try again");
    await refreshProfile();
    setSaved(true);
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-[15px] font-semibold text-ink tracking-tight mb-4">Profile</h2>

      <div className="flex items-center gap-4 mb-5">
        <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="lg" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="text-sm bg-accent hover:bg-accent-strong text-white rounded-xl px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? "Working…" : "Upload image"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
      </div>

      {error && <p className="text-danger text-sm mb-3">{error}</p>}
      {saved && <p className="text-online text-sm mb-3">Saved</p>}

      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Display name</label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            maxLength={DISPLAY_MAX}
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mt-1"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Username</label>
          <input
            value={profile ? `@${profile.username}` : ""}
            readOnly
            className="w-full p-2 rounded-xl bg-surface-2 text-muted text-sm mt-1 cursor-not-allowed"
          />
          <p className="text-muted text-xs mt-1">This is your @handle — people use it to mention you.</p>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Status</label>
          <input
            value={status}
            onChange={(e) => { setStatus(e.target.value); setSaved(false); }}
            maxLength={STATUS_MAX}
            placeholder="What's happening?"
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mt-1"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => { setBio(e.target.value); setSaved(false); }}
            maxLength={BIO_MAX}
            rows={3}
            placeholder="Tell people about yourself"
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mt-1 resize-none"
          />
          <div className="text-muted text-[10px] text-right">{bio.length}/{BIO_MAX}</div>
        </div>

        <button
          onClick={save}
          disabled={busy}
          className="bg-accent hover:bg-accent-strong text-white font-medium rounded-xl px-5 py-2 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

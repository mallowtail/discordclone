"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSafety } from "@/components/providers/SafetyProvider";
import { Avatar } from "@/components/user/profile/Avatar";
import type { Profile } from "@/types/db";
import type { HiddenKind } from "@/lib/users/safety";

const DM_OPTIONS: { value: Profile["dm_policy"]; label: string; hint: string }[] = [
  { value: "reachable", label: "Friends and people in your servers", hint: "Also people you share a DM or group chat with." },
  { value: "friends", label: "Friends only", hint: "Only friends can DM you or add you to group chats." },
  { value: "none", label: "No one", hint: "Nobody can message you or add you to groups. Your old DMs stay readable." },
];

type SettingsPatch = Partial<Pick<Profile, "dm_policy" | "fr_everyone" | "fr_friends_of_friends" | "fr_server_members">>;

/** Settings → Privacy & Safety: who can DM you / send friend requests, and your blocked and ignored lists. */
export function PrivacySection() {
  const supabase = useMemo(() => createClient(), []);
  const { user, profile, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save(patch: SettingsPatch) {
    if (!user) return;
    setSaving(true);
    setStatus(null);
    const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
    await refreshProfile();
    setSaving(false);
    setStatus(error ? "Couldn't save — try again" : "Saved");
  }

  if (!profile) return null;
  const everyone = profile.fr_everyone;

  return (
    <div className="max-w-xl">
      <h2 className="text-title font-semibold text-ink tracking-tight mb-1">Privacy &amp; Safety</h2>
      <p className="text-meta text-muted mb-6" role="status">{saving ? "Saving…" : status ?? "Changes save as you make them."}</p>

      <section>
        <h3 className="text-body font-semibold text-ink">Who can DM you</h3>
        <p className="mt-0.5 text-meta text-muted">This also decides who can add you to group chats.</p>
        <div className="mt-3 space-y-2" role="radiogroup" aria-label="Who can DM you">
          {DM_OPTIONS.map((o) => (
            <label key={o.value} className={`flex items-start gap-3 rounded-card border px-3 py-2.5 cursor-pointer ${
              profile.dm_policy === o.value ? "border-accent bg-accent/10" : "border-line hover:bg-surface-2"
            }`}>
              <input type="radio" name="dm_policy" value={o.value} checked={profile.dm_policy === o.value} disabled={saving}
                onChange={() => save({ dm_policy: o.value })} className="mt-1 w-4 h-4 accent-accent" />
              <span>
                <span className="block text-body text-ink">{o.label}</span>
                <span className="block text-meta text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h3 className="text-body font-semibold text-ink">Who can send you friend requests</h3>
        <div className="mt-3 space-y-2">
          <Check label="Everyone" checked={everyone} disabled={saving} onChange={(v) => save({ fr_everyone: v })} />
          {/* "Everyone" already includes these two, so they show as on while it's ticked. */}
          <Check label="Friends of friends" checked={everyone || profile.fr_friends_of_friends} disabled={saving || everyone}
            onChange={(v) => save({ fr_friends_of_friends: v })} />
          <Check label="People in your servers" checked={everyone || profile.fr_server_members} disabled={saving || everyone}
            onChange={(v) => save({ fr_server_members: v })} />
        </div>
        {!everyone && !profile.fr_friends_of_friends && !profile.fr_server_members && (
          <p className="mt-2 text-meta text-muted">Nobody can send you friend requests. You can still send them.</p>
        )}
      </section>

      <BlockList kind="block" title="Blocked" empty="You haven't blocked anyone." undo="Unblock" />
      <BlockList kind="ignore" title="Ignored" empty="You haven't ignored anyone." undo="Unignore" />
    </div>
  );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex items-center gap-3 text-body ${disabled ? "text-muted" : "text-ink cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-accent" />
      {label}
    </label>
  );
}

function BlockList({ kind, title, empty, undo }: { kind: HiddenKind; title: string; empty: string; undo: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { entries, clear } = useSafety();
  const ids = entries.filter((e) => e.kind === kind).map((e) => e.userId);
  const idsKey = ids.join(",");
  const [people, setPeople] = useState<Profile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!idsKey) return;
    let active = true;
    supabase.from("profiles").select("*").in("id", idsKey.split(",")).then(({ data }) => {
      if (active) setPeople((data as Profile[] | null) ?? []);
    });
    return () => { active = false; };
  }, [supabase, idsKey]);

  const shown = people.filter((p) => ids.includes(p.id));

  return (
    <section className="mt-8">
      <h3 className="text-body font-semibold text-ink">{title}{ids.length > 0 && <span className="text-muted font-normal"> — {ids.length}</span>}</h3>
      {ids.length === 0 ? (
        <p className="mt-2 text-body text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border border-line rounded-card overflow-hidden">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar url={p.avatar_url} name={p.display_name} seed={p.id} size="sm" />
              <span className="flex-1 min-w-0 truncate text-body text-ink">{p.display_name} <span className="text-muted">@{p.username}</span></span>
              <button type="button" disabled={busy === p.id}
                onClick={async () => { setBusy(p.id); await clear(p.id); setBusy(null); }}
                className="text-meta text-muted hover:text-ink disabled:opacity-50 min-h-11 md:min-h-0">
                {busy === p.id ? "…" : undo}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

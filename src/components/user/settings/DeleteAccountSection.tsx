"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useVoice } from "@/components/providers/VoiceProvider";
import { useServers } from "@/hooks/useServers";
import { ServerIcon } from "@/components/servers/layout/ServerIcon";
import { ServerSettings } from "@/components/servers/settings/ServerSettings";
import { TypeToConfirmDialog } from "@/components/ui/TypeToConfirmDialog";
import { storagePathFromPublicUrl } from "@/lib/media/url";
import {
  OWNS_SERVERS_MESSAGE, deleteAccountErrorMessage, hasPasswordLogin, usernameConfirmMatches, verifyPassword,
} from "@/lib/users/account";

/**
 * Settings → Account danger zone. Deleting keeps your messages (shown as "Deleted User") and erases
 * everything else (migration 0046). Owners must pass on or delete their servers first — the
 * database refuses otherwise — so those servers are listed with a shortcut to their settings.
 */
export function DeleteAccountSection() {
  const supabase = useMemo(() => createClient(), []);
  const { user, profile, signOut } = useAuth();
  const voice = useVoice();
  const { servers, reload } = useServers();
  const [confirming, setConfirming] = useState(false);
  const [openServerId, setOpenServerId] = useState<string | null>(null);

  if (!user || !profile) return null;
  const owned = servers.filter((s) => s.owner_id === user.id);
  // Stays open after a transfer (no longer owned, still a member); closes once the server is deleted.
  const openServer = servers.find((s) => s.id === openServerId) ?? null;
  // Email + password accounts confirm with their password; Discord/GitHub-only ones have none.
  const withPassword = hasPasswordLogin(user) && !!user.email;
  const username = profile.username;

  async function deleteAccount(typed: string): Promise<string | null> {
    if (!user) return "You're signed out.";
    if (withPassword) {
      const check = await verifyPassword(supabase, user.email!, typed);
      if (!check.ok) return "Wrong password";
    } else if (!usernameConfirmMatches(typed, username)) {
      return "That's not your username";
    }

    // Still own a server (e.g. just made one in another tab)? Stop before touching anything.
    const { count } = await supabase.from("servers").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
    if ((count ?? 0) > 0) {
      reload();
      return OWNS_SERVERS_MESSAGE;
    }

    await voice.leave();
    // The database keeps storage files; remove our own avatar first (an outside Discord/GitHub
    // picture has no file here).
    const avatarPath = storagePathFromPublicUrl(profile?.avatar_url, "avatars");
    if (avatarPath) await supabase.storage.from("avatars").remove([avatarPath]);

    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      reload();
      return deleteAccountErrorMessage(error.message);
    }
    // The login is gone; just forget this browser's session and start fresh on the login page
    // (a full page load, so nothing from the old account lingers in memory).
    await signOut({ scope: "local" });
    window.location.replace("/login?deleted=1");
    return null;
  }

  return (
    <section className="mt-10 rounded-card border border-danger/40 p-4">
      <h3 className="text-body font-semibold text-danger">Delete account</h3>
      <p className="mt-1 text-meta text-muted">
        Your messages stay, shown as &ldquo;Deleted User&rdquo;. Everything else is erased: your name, picture, bio,
        friends, blocks, favorites and settings, and your login. This can&apos;t be undone.
      </p>

      {owned.length > 0 && (
        <div className="mt-3 rounded-control border border-line bg-surface-2 p-3">
          <p role="status" className="text-meta text-ink">{OWNS_SERVERS_MESSAGE}</p>
          <ul className="mt-2 space-y-1">
            {owned.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                <ServerIcon iconUrl={s.icon_url} name={s.name} />
                <span className="min-w-0 flex-1 truncate text-body text-ink">{s.name}</span>
                <button type="button" onClick={() => setOpenServerId(s.id)}
                  className="flex-none rounded-control border border-line px-3 py-1.5 text-meta font-medium text-ink hover:bg-surface">
                  Open settings
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" onClick={() => setConfirming(true)} disabled={owned.length > 0}
        className="mt-3 rounded-control bg-danger px-4 py-2 text-body font-medium text-white hover:bg-danger/90 disabled:opacity-50">
        Delete account
      </button>

      {confirming && (
        <TypeToConfirmDialog
          title="Delete your account?"
          message="Your messages will stay as “Deleted User”. Everything else about you is erased, and this can't be undone."
          label={withPassword ? "Your password" : `Type your username (${username}) to confirm`}
          inputType={withPassword ? "password" : "text"}
          autoComplete={withPassword ? "current-password" : "off"}
          confirmLabel="Delete account"
          busyLabel="Deleting…"
          canConfirm={(v) => (withPassword ? v.length > 0 : usernameConfirmMatches(v, username))}
          onConfirm={deleteAccount}
          onClose={() => setConfirming(false)}
        />
      )}
      {openServer && createPortal(
        <ServerSettings server={openServer} onSaved={reload} onClose={() => { setOpenServerId(null); reload(); }} />,
        document.body,
      )}
    </section>
  );
}

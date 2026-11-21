// Deleting your own account (migration 0046) and the "Deleted User" placeholder it leaves behind.

/** The name every deleted account shows (the database writes it into the tombstone). */
export const DELETED_USER_NAME = "Deleted User";

/** Shown when the person still owns servers (the database refuses with
 *  `transfer or delete your servers first`). */
export const OWNS_SERVERS_MESSAGE =
  "You own these servers. Pass on ownership to someone else (or delete the server) before deleting your account.";

/** Shown when the database refuses because the signed-in account is site-banned (migration 0052). */
export const BANNED_ACCOUNT_MESSAGE = "This account has been banned from Mallowchat.";

/** True for the database's `this account has been banned` refusal. */
export function isBannedAccountError(message: string | null | undefined): boolean {
  return !!message?.includes("this account has been banned");
}

type AccountState = { deleted_at?: string | null; banned_at?: string | null };

/** True while the account is site-banned (`profiles.banned_at`, set only by the site admin). */
export function isBannedProfile(p: AccountState | null | undefined): boolean {
  return !!p?.banned_at;
}

/**
 * True when the profile is shown as "Deleted User": a tombstone (deleted account) or a site-banned
 * account. Banned people look exactly like deleted ones to everyone but the site admin (nothing about
 * them is erased, so they come back as they were if unbanned).
 */
export function isDeletedProfile(p: AccountState | null | undefined): boolean {
  return !!p?.deleted_at || !!p?.banned_at;
}

/** The tombstone-style username (`deleted_` + the id's first 8 hex digits), as migration 0046 writes it. */
export function deletedUsernameFor(id: string): string {
  return `deleted_${id.replace(/-/g, "").slice(0, 8)}`;
}

type ShowableProfile = AccountState & {
  id: string;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  bio?: string | null;
  status?: string | null;
};

/**
 * The profile as everyone (but the site admin) should see it: a banned account is dressed as a
 * "Deleted User" tombstone (name, @username, avatar, bio and status hidden), so every check that
 * works for deleted accounts (`isDeletedProfile`, `isDeletedUsername`) works for it too. Anything else
 * comes back unchanged (same object).
 */
export function shownProfile<T extends ShowableProfile>(p: T): T {
  if (!p.banned_at || p.deleted_at) return p;
  const masked: Record<string, unknown> = { ...p };
  if ("display_name" in p) masked.display_name = DELETED_USER_NAME;
  if ("username" in p) masked.username = deletedUsernameFor(p.id);
  if ("avatar_url" in p) masked.avatar_url = null;
  if ("bio" in p) masked.bio = null;
  if ("status" in p) masked.status = null;
  return masked as T;
}

/** `shownProfile` for a possibly-missing profile. */
export function shownProfileOrNull<T extends ShowableProfile>(p: T | null | undefined): T | null {
  return p ? shownProfile(p) : null;
}

/** True for a tombstone's username (`deleted_…`). Live accounts can't have one (the database's
 *  profiles_username_reserved check), so this works where only the username is at hand, e.g. search results. */
export function isDeletedUsername(username: string | null | undefined): boolean {
  return !!username && /^deleted_/i.test(username);
}

type AuthUserLike = {
  identities?: { provider: string }[] | null;
  app_metadata?: { provider?: string; providers?: string[] };
};

/** True when the account can sign in with an email + password (so it can confirm with one).
 *  Discord/GitHub-only accounts have no password and confirm by typing their username instead. */
export function hasPasswordLogin(user: AuthUserLike): boolean {
  if (user.identities && user.identities.length > 0) return user.identities.some((i) => i.provider === "email");
  const meta = user.app_metadata;
  const providers = meta?.providers ?? (meta?.provider ? [meta.provider] : []);
  return providers.includes("email");
}

type PasswordAuth = {
  auth: {
    signInWithPassword: (args: {
      email: string;
      password: string;
      options?: { captchaToken?: string };
    }) => Promise<{ error: { message: string } | null }>;
  };
};

/**
 * Check a password by signing in again with it (Supabase has no "check password" call). Once the
 * bot check is on in Supabase, every password sign-in needs a Turnstile token, so callers pass one
 * in `captchaToken`.
 */
export async function verifyPassword(
  supabase: PasswordAuth,
  email: string,
  password: string,
  captchaToken?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** The "type your username to confirm" check: ignores case, surrounding spaces and a leading @. */
export function usernameConfirmMatches(typed: string, username: string): boolean {
  const t = typed.trim().replace(/^@/, "");
  return t.length > 0 && t.toLowerCase() === username.toLowerCase();
}

/** User-facing text for a failed `delete_my_account`. */
export function deleteAccountErrorMessage(message: string | undefined): string {
  if (message?.includes("transfer or delete your servers first")) return OWNS_SERVERS_MESSAGE;
  if (message?.includes("this account was deleted")) return "This account was already deleted.";
  if (isBannedAccountError(message)) return BANNED_ACCOUNT_MESSAGE;
  return "Couldn't delete your account — try again.";
}

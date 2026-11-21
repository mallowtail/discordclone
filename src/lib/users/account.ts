// Deleting your own account (migration 0046) and the "Deleted User" placeholder it leaves behind.

/** The name every deleted account shows (the database writes it into the tombstone). */
export const DELETED_USER_NAME = "Deleted User";

/** Shown when the person still owns servers (the database refuses with
 *  `transfer or delete your servers first`). */
export const OWNS_SERVERS_MESSAGE =
  "You own these servers. Pass on ownership to someone else (or delete the server) before deleting your account.";

/** True for a tombstone: a profile whose account was deleted. */
export function isDeletedProfile(p: { deleted_at?: string | null } | null | undefined): boolean {
  return !!p?.deleted_at;
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
  return "Couldn't delete your account — try again.";
}

import { BANNED_ACCOUNT_MESSAGE, isBannedAccountError } from "@/lib/users/account";

export type Validated = { ok: true; value: string } | { ok: false; error: string };

export function validateMessage(input: string): Validated {
  const value = input.trim();
  if (value.length === 0) return { ok: false, error: "Message is empty" };
  if (value.length > 2000) return { ok: false, error: "Message too long (max 2000)" };
  return { ok: true, value };
}

const USERNAME_FORMAT_ERROR = "1-20 letters, numbers, or underscores only";
const USERNAME_RESERVED_ERROR = "Usernames can't start with deleted_";

/** Same rules as the database (migration 0046): 1–20 of A-Z a-z 0-9 _, and not starting with
 *  `deleted_` (any case) — those names belong to deleted accounts. */
export function validateUsername(input: string): Validated {
  const value = input.trim();
  if (!/^[A-Za-z0-9_]{1,20}$/.test(value)) {
    return { ok: false, error: USERNAME_FORMAT_ERROR };
  }
  if (/^deleted_/i.test(value)) return { ok: false, error: USERNAME_RESERVED_ERROR };
  return { ok: true, value };
}

/** User-facing text for a failed profile insert/update that set a username. */
export function usernameErrorMessage(message: string | undefined): string {
  if (message?.includes("duplicate") || message?.includes("profiles_username_key")) return "That username's taken — try another";
  if (message?.includes("profiles_username_reserved")) return USERNAME_RESERVED_ERROR;
  if (message?.includes("profiles_username_format")) return USERNAME_FORMAT_ERROR;
  if (message?.includes("this account was deleted")) return "This account was deleted.";
  if (isBannedAccountError(message)) return BANNED_ACCOUNT_MESSAGE;
  return "Couldn't save — try again";
}

/** User-facing text for a failed message insert (the database enforces a spam limit). */
export function sendErrorMessage(message: string | undefined): string {
  if (message?.includes("slow down")) return "You're sending messages too fast — wait a few seconds.";
  if (message?.includes("cannot message this person")) return "Your message couldn't be delivered. They may only accept messages from some people.";
  if (message?.includes("cannot use that sticker")) return "You can't use that sticker anymore.";
  if (isBannedAccountError(message)) return BANNED_ACCOUNT_MESSAGE;
  return "Failed to send — try again";
}

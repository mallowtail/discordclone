// Messages for the Turnstile bot check on the sign-in forms.

export const CAPTCHA_FAILED_MESSAGE = "The bot check failed — please try again.";
export const CAPTCHA_LOAD_MESSAGE = "Couldn't load the bot check — refresh the page and try again.";
export const CAPTCHA_WAITING_MESSAGE = "Checking you're not a bot…";

/** True when a Supabase auth error is about the bot check (missing, expired or rejected token). */
export function isCaptchaError(message: string | null | undefined): boolean {
  return !!message && /captcha/i.test(message);
}

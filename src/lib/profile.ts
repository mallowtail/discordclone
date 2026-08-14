export const STATUS_MAX = 128;
export const BIO_MAX = 190;
export const DISPLAY_MAX = 32;

/** Trim, collapse blank to "", and truncate to `max` characters. */
export function clampProfileText(input: string, max: number): string {
  const trimmed = input.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Trimmed display name; ok only when non-empty and within DISPLAY_MAX. */
export function validateDisplayName(
  input: string
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: "Display name can't be empty" };
  if (trimmed.length > DISPLAY_MAX) return { ok: false, error: `Keep it under ${DISPLAY_MAX} characters` };
  return { ok: true, value: trimmed };
}

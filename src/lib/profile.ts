export const STATUS_MAX = 128;
export const BIO_MAX = 190;

/** Trim, collapse blank to "", and truncate to `max` characters. */
export function clampProfileText(input: string, max: number): string {
  const trimmed = input.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

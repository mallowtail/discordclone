/**
 * Fixed 8-pair avatar palette. Each pair clears 4.5:1 WCAG contrast between its own bg and fg
 * (verified with the standard relative-luminance formula — see task-2-report.md for the computed
 * ratios), and each bg sits comfortably on the app's dark surfaces (--color-surface #26282c,
 * --color-sidebar #141517) without blending into them.
 */
const PALETTE: { bg: string; fg: string }[] = [
  { bg: "#5865F2", fg: "#FFFFFF" }, // blurple
  { bg: "#EB459E", fg: "#1A1B1E" }, // pink
  { bg: "#2F844A", fg: "#FFFFFF" }, // green
  { bg: "#F0B86B", fg: "#1A1B1E" }, // amber
  { bg: "#D53B3E", fg: "#FFFFFF" }, // red
  { bg: "#59C1E8", fg: "#1A1B1E" }, // cyan
  { bg: "#885ED3", fg: "#FFFFFF" }, // purple
  { bg: "#8B6B4A", fg: "#FFFFFF" }, // brown
];

/** Deterministic small string hash (djb2 variant, unsigned 32-bit). */
function hash(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 33) ^ seed.charCodeAt(i);
  }
  return h >>> 0;
}

/** Deterministic bg/fg pair for a seed (e.g. a user id), picked from a fixed 8-entry palette. */
export function avatarColor(seed: string): { bg: string; fg: string } {
  return PALETTE[hash(seed) % PALETTE.length];
}

/**
 * At most 2 uppercase characters, taken from the first letter of the first and last
 * whitespace-separated words. Single-word names return one character. Returns "?" for
 * null/undefined/empty/whitespace-only input.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words[words.length - 1][0];
  const chars = words.length === 1 ? first : first + last;
  return chars.toUpperCase();
}

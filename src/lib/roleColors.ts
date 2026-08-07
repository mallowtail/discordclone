export const ROLE_COLORS: string[] = [
  "#7c9cff", "#f0b86b", "#3ba55d", "#f87171", "#a78bfa",
  "#f472b6", "#22d3ee", "#94a3b8", "#eab308", "#fb923c",
];

/** True for #rgb or #rrggbb (case-insensitive). */
export function validateHexColor(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

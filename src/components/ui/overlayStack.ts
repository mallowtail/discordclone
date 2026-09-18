/**
 * Tracks the stack of currently-mounted overlays (Modal/Drawer instances) app-wide, so a
 * single Escape keypress closes only the topmost one.
 *
 * Without this, ConfirmDialog opened on top of an already-open Modal (or Drawer) — exactly the
 * composition Task 3 needs for a destructive confirm launched from an open settings dialog —
 * would have both instances' independent document-level Escape listeners fire on the same
 * keypress, closing the parent dialog along with the confirm prompt.
 *
 * New file, not in Task 2's original brief file list — added to fix a G10 review finding
 * (Escape closing every stacked dialog at once) without duplicating stack-tracking logic
 * between Modal.tsx and Drawer.tsx.
 */

export type OverlayToken = symbol;

const stack: OverlayToken[] = [];

/** Registers a newly-opened overlay as the new top of the stack. Call on mount (effect setup). */
export function pushOverlay(): OverlayToken {
  const token = Symbol("overlay");
  stack.push(token);
  return token;
}

/** Unregisters an overlay, wherever it sits in the stack. Call on unmount (effect cleanup). */
export function popOverlay(token: OverlayToken): void {
  const index = stack.lastIndexOf(token);
  if (index !== -1) stack.splice(index, 1);
}

/** True if `token` is the most-recently-opened overlay that is still mounted. */
export function isTopOverlay(token: OverlayToken): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token;
}

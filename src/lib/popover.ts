type Rect = { top: number; bottom: number; left: number; right: number };
type Size = { width: number; height: number };

/** Position a popover card next to an anchor, clamped on-screen (8px margin). */
export function computePopoverPosition(anchor: Rect, card: Size, viewport: Size): { top: number; left: number } {
  const M = 8;
  let left = anchor.right + M;
  if (left + card.width > viewport.width - M) {
    left = anchor.left - M - card.width; // flip to the left of the anchor
  }
  left = Math.max(M, Math.min(left, viewport.width - M - card.width));
  let top = anchor.top;
  if (top + card.height > viewport.height - M) {
    top = viewport.height - M - card.height;
  }
  top = Math.max(M, top);
  return { top, left };
}

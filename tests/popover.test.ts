import { describe, it, expect } from "vitest";
import { computePopoverPosition } from "@/lib/popover";

const vp = { width: 1000, height: 800 };

describe("computePopoverPosition", () => {
  it("places the card to the right of the anchor by default", () => {
    const p = computePopoverPosition({ top: 100, bottom: 120, left: 80, right: 100 }, { width: 200, height: 150 }, vp);
    expect(p.left).toBe(108);
    expect(p.top).toBe(100);
  });
  it("flips to the left when the right side would overflow", () => {
    const p = computePopoverPosition({ top: 100, bottom: 120, left: 900, right: 950 }, { width: 200, height: 150 }, vp);
    expect(p.left).toBe(692); // 900 - 8 - 200
  });
  it("clamps the top so the card stays on-screen", () => {
    const p = computePopoverPosition({ top: 750, bottom: 770, left: 80, right: 100 }, { width: 200, height: 300 }, vp);
    expect(p.top).toBe(492); // 800 - 8 - 300
  });
  it("never positions above the top margin", () => {
    const p = computePopoverPosition({ top: -50, bottom: -30, left: 80, right: 100 }, { width: 200, height: 150 }, vp);
    expect(p.top).toBe(8);
  });
});

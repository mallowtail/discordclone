import { describe, it, expect } from "vitest";
import { roomForChannel, roomForConversation, parseRoom } from "@/lib/voice/rooms";

const ID = "1a25ed42-b3f0-49bd-86ab-5af61df89a7c";

describe("voice room names", () => {
  it("names rooms by what they belong to", () => {
    expect(roomForChannel(ID)).toBe(`ch_${ID}`);
    expect(roomForConversation(ID)).toBe(`dm_${ID}`);
  });
  it("parses them back", () => {
    expect(parseRoom(`ch_${ID}`)).toEqual({ type: "channel", id: ID });
    expect(parseRoom(`dm_${ID}`)).toEqual({ type: "conversation", id: ID });
  });
  it("rejects anything else", () => {
    for (const bad of ["", "ch_", `xx_${ID}`, "ch_not-a-uuid", `ch_${ID}x`, `ch_${ID.toUpperCase()}`, `dm_${ID}/../x`]) {
      expect(parseRoom(bad), bad).toBeNull();
    }
  });
});

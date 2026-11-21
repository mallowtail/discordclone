import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, HOLD_MS, MIN_DB, isAllowedPttKey, keyLabel, levelDb, meterPercent, parseVoiceSettings, voiceGate,
} from "@/lib/voice/settings";

describe("parseVoiceSettings", () => {
  it("defaults when nothing or junk is stored", () => {
    expect(parseVoiceSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseVoiceSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseVoiceSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    expect(parseVoiceSettings('"x"')).toEqual(DEFAULT_SETTINGS);
  });
  it("keeps valid values", () => {
    const s = { inputId: "mic1", outputId: "spk2", mode: "ptt", threshold: -30, pttKey: "KeyV" };
    expect(parseVoiceSettings(JSON.stringify(s))).toEqual(s);
  });
  it("fixes bad fields one by one", () => {
    const s = parseVoiceSettings(JSON.stringify({ inputId: 5, mode: "shout", threshold: 40, pttKey: "" }));
    expect(s).toEqual({ ...DEFAULT_SETTINGS, threshold: 0 });
    expect(parseVoiceSettings(JSON.stringify({ threshold: -500 })).threshold).toBe(MIN_DB);
    expect(parseVoiceSettings(JSON.stringify({ threshold: "loud" })).threshold).toBe(DEFAULT_SETTINGS.threshold);
    expect(parseVoiceSettings(JSON.stringify({ inputId: "x".repeat(500) })).inputId).toBe("");
  });
});

describe("levelDb / meterPercent", () => {
  it("silence is the floor", () => {
    expect(levelDb([])).toBe(MIN_DB);
    expect(levelDb([0, 0, 0])).toBe(MIN_DB);
    expect(meterPercent(MIN_DB)).toBe(0);
  });
  it("full scale is 0 dB", () => {
    expect(levelDb([1, -1, 1, -1])).toBeCloseTo(0);
    expect(meterPercent(0)).toBe(100);
  });
  it("half amplitude is about -6 dB", () => {
    expect(levelDb([0.5, -0.5])).toBeCloseTo(-6.02, 1);
    expect(meterPercent(-50)).toBe(50);
    expect(meterPercent(20)).toBe(100);
  });
});

describe("voiceGate", () => {
  it("opens at the threshold", () => {
    expect(voiceGate(-40, -50, 1000, null)).toEqual({ open: true, lastLoudAt: 1000 });
    expect(voiceGate(-50, -50, 1000, null).open).toBe(true);
  });
  it("stays closed while quiet", () => {
    expect(voiceGate(-70, -50, 1000, null)).toEqual({ open: false, lastLoudAt: null });
  });
  it("holds open briefly after talking, then closes", () => {
    expect(voiceGate(-70, -50, 1000 + HOLD_MS - 1, 1000).open).toBe(true);
    expect(voiceGate(-70, -50, 1000 + HOLD_MS, 1000).open).toBe(false);
  });
});

describe("keyLabel / isAllowedPttKey", () => {
  it("names keys readably", () => {
    expect(keyLabel("KeyV")).toBe("V");
    expect(keyLabel("Digit3")).toBe("3");
    expect(keyLabel("Backquote")).toBe("`");
    expect(keyLabel("F13")).toBe("F13");
    expect(keyLabel("ShiftLeft")).toBe("Left Shift");
    expect(keyLabel("ControlRight")).toBe("Right Ctrl");
    expect(keyLabel("Numpad0")).toBe("Numpad 0");
    expect(keyLabel("MediaPlayPause")).toBe("MediaPlayPause");
  });
  it("refuses Escape", () => {
    expect(isAllowedPttKey("Escape")).toBe(false);
    expect(isAllowedPttKey("KeyV")).toBe(true);
  });
});

/**
 * Voice settings (Settings → Voice). They're saved in this browser only, because microphones and
 * speakers belong to the computer, not the account.
 */

export type InputMode = "voice" | "ptt";

export type VoiceSettings = {
  /** Microphone deviceId; "" = the system default. */
  inputId: string;
  /** Speaker deviceId; "" = the system default. */
  outputId: string;
  /** Voice activity (send when you talk) or push to talk (send while a key is held). */
  mode: InputMode;
  /** Voice activity: sound quieter than this (in dB, -100 = silence … 0 = loudest) isn't sent. */
  threshold: number;
  /** Push to talk: the key's KeyboardEvent.code, e.g. "Backquote". */
  pttKey: string;
};

export const MIN_DB = -100;
export const DEFAULT_SETTINGS: VoiceSettings = { inputId: "", outputId: "", mode: "voice", threshold: -55, pttKey: "Backquote" };
export const STORAGE_KEY = "mallowchat.voice";

/** Settings from storage, falling back to the default for anything missing or broken. */
export function parseVoiceSettings(raw: string | null): VoiceSettings {
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) v = parsed as Record<string, unknown>;
  } catch {
    // broken JSON → defaults
  }
  const str = (x: unknown, max: number) => (typeof x === "string" && x.length <= max ? x : null);
  const threshold = typeof v.threshold === "number" && Number.isFinite(v.threshold)
    ? Math.min(0, Math.max(MIN_DB, Math.round(v.threshold)))
    : DEFAULT_SETTINGS.threshold;
  const pttKey = str(v.pttKey, 40);
  return {
    inputId: str(v.inputId, 200) ?? DEFAULT_SETTINGS.inputId,
    outputId: str(v.outputId, 200) ?? DEFAULT_SETTINGS.outputId,
    mode: v.mode === "ptt" ? "ptt" : "voice",
    threshold,
    pttKey: pttKey && pttKey !== "" ? pttKey : DEFAULT_SETTINGS.pttKey,
  };
}

/** Loudness of a block of samples (-1…1) in dB, from MIN_DB (silence) to 0. */
export function levelDb(samples: ArrayLike<number>): number {
  if (samples.length === 0) return MIN_DB;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return MIN_DB;
  return Math.max(MIN_DB, Math.min(0, 20 * Math.log10(rms)));
}

/** Where a dB value sits on a 0–100 meter. */
export function meterPercent(db: number): number {
  return Math.round(((Math.min(0, Math.max(MIN_DB, db)) - MIN_DB) / -MIN_DB) * 100);
}

/** How long voice activity stays open after you stop talking, so word endings aren't cut off. */
export const HOLD_MS = 400;

/**
 * Voice activity gate: open as soon as the level reaches the threshold, and stay open for HOLD_MS
 * after the last loud moment. Returns whether to send sound, and the new "last loud" time.
 */
export function voiceGate(db: number, threshold: number, now: number, lastLoudAt: number | null): { open: boolean; lastLoudAt: number | null } {
  if (db >= threshold) return { open: true, lastLoudAt: now };
  const open = lastLoudAt !== null && now - lastLoudAt < HOLD_MS;
  return { open, lastLoudAt };
}

/** A readable name for a KeyboardEvent.code: "KeyV" → "V", "Backquote" → "`", "ShiftLeft" → "Left Shift". */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Numpad ${code.slice(6)}`;
  if (/^F[0-9]{1,2}$/.test(code)) return code;
  const named: Record<string, string> = {
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Space: "Space", CapsLock: "Caps Lock",
    Tab: "Tab", Enter: "Enter", Backspace: "Backspace", Insert: "Insert", Delete: "Delete", Home: "Home", End: "End",
    PageUp: "Page Up", PageDown: "Page Down", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  };
  if (named[code]) return named[code];
  const side = code.match(/^(Shift|Control|Alt|Meta)(Left|Right)$/);
  if (side) return `${side[2]} ${side[1] === "Control" ? "Ctrl" : side[1] === "Meta" ? "Cmd/Win" : side[1]}`;
  return code;
}

/** Keys that can't be push-to-talk: Escape closes things. */
export function isAllowedPttKey(code: string): boolean {
  return code !== "" && code !== "Escape";
}

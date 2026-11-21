import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { levelDb, voiceGate, type InputMode } from "@/lib/voice/settings";

export type MicGate = {
  processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>;
  /** Voice activity (with a threshold) or push to talk. */
  configure: (mode: InputMode, threshold: number) => void;
  /** Push to talk: whether the key is held. */
  setKeyDown: (down: boolean) => void;
};

const TICK_MS = 20;

/**
 * Sits between your microphone and what LiveKit sends. It passes sound through only when you're
 * talking loud enough (voice activity) or holding the push-to-talk key, and sends silence otherwise.
 * You're not shown as muted while it's closed — you're just quiet, like Discord.
 */
export function createMicGate(mode: InputMode, threshold: number): MicGate {
  let cfg = { mode, threshold };
  let keyDown = false;
  let lastLoudAt: number | null = null;
  let parts: { src: MediaStreamAudioSourceNode; gain: GainNode; timer: ReturnType<typeof setInterval>; ctx: AudioContext } | null = null;

  const teardown = () => {
    if (!parts) return;
    clearInterval(parts.timer);
    parts.src.disconnect();
    parts.gain.disconnect();
    parts = null;
  };

  const setOpen = (ctx: AudioContext, gain: GainNode, open: boolean) => {
    // Short fade so opening and closing don't click.
    gain.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, open ? 0.005 : 0.03);
  };

  const processor: MicGate["processor"] = {
    name: "mallowchat-mic-gate",
    processedTrack: undefined,
    async init(opts) {
      teardown();
      const ctx = opts.audioContext;
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(new MediaStream([opts.track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const dest = ctx.createMediaStreamDestination();
      src.connect(analyser);
      src.connect(gain).connect(dest);
      const buf = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        let open: boolean;
        if (cfg.mode === "ptt") {
          open = keyDown;
        } else {
          analyser.getFloatTimeDomainData(buf);
          const g = voiceGate(levelDb(buf), cfg.threshold, Date.now(), lastLoudAt);
          lastLoudAt = g.lastLoudAt;
          open = g.open;
        }
        setOpen(ctx, gain, open);
      }, TICK_MS);
      parts = { src, gain, timer, ctx };
      processor.processedTrack = dest.stream.getAudioTracks()[0];
    },
    async restart(opts) {
      await processor.init(opts);
    },
    async destroy() {
      teardown();
      processor.processedTrack = undefined;
    },
  };

  return {
    processor,
    configure(m, t) {
      cfg = { mode: m, threshold: t };
      lastLoudAt = null;
    },
    setKeyDown(down) {
      keyDown = down;
      // React right away rather than on the next tick.
      if (parts && cfg.mode === "ptt") setOpen(parts.ctx, parts.gain, down);
    },
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoice } from "@/components/providers/VoiceProvider";
import { Dropdown } from "@/components/ui/Dropdown";
import { MIN_DB, isAllowedPttKey, keyLabel, levelDb, meterPercent, type InputMode } from "@/lib/voice/settings";

type Devices = { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; named: boolean };

/** Browsers that can send sound to a chosen speaker (not Safari or phones, mostly). */
const canPickOutput = () => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

const MODES: { value: InputMode; label: string; hint: string }[] = [
  { value: "voice", label: "Voice activity", hint: "Your mic sends sound when you talk louder than the sensitivity line." },
  { value: "ptt", label: "Push to talk", hint: "Your mic only sends sound while you hold a key." },
];

/** Settings → Voice: microphone and speaker, a mic test, voice activity sensitivity and push to talk. */
export function VoiceSection() {
  const { settings, updateSettings } = useVoice();
  const [devices, setDevices] = useState<Devices>({ inputs: [], outputs: [], named: false });
  const [testing, setTesting] = useState(false);
  const [hearSelf, setHearSelf] = useState(false);
  const [level, setLevel] = useState(MIN_DB);
  const [testError, setTestError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const loopbackRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const listDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
    const outputs = all.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications");
    // Until you've allowed the microphone once, browsers hide device names.
    setDevices({ inputs, outputs, named: inputs.some((d) => d.label) });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the device list from the browser (async)
    void listDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", listDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", listDevices);
  }, [listDevices]);

  // Mic test: open the chosen mic on its own (separate from any call) and show how loud it is.
  useEffect(() => {
    if (!testing) return;
    let stopped = false;
    const loopback = loopbackRef.current;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: settings.inputId ? { deviceId: { exact: settings.inputId } } : true,
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        setTestError(null);
        void listDevices(); // names are visible now
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        timer = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          setLevel(levelDb(buf));
        }, 50);
        if (loopback) loopback.srcObject = stream;
      } catch {
        if (!stopped) {
          setTestError("Couldn't open your microphone — allow it in the browser (the icon next to the address bar).");
          setTesting(false);
        }
      }
    })();
    return () => {
      stopped = true;
      clearInterval(timer);
      void ctx?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (loopback) loopback.srcObject = null;
      setLevel(MIN_DB);
    };
  }, [testing, settings.inputId, listDevices]);

  // "Hear yourself" plays the test back through the chosen speaker.
  useEffect(() => {
    const el = loopbackRef.current;
    if (!el) return;
    el.muted = !hearSelf;
    if (canPickOutput()) {
      void (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(settings.outputId).catch(() => {});
    }
    if (hearSelf && testing) void el.play().catch(() => {});
  }, [hearSelf, testing, settings.outputId]);

  // Picking a push-to-talk key: the next key you press (Escape cancels).
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (isAllowedPttKey(e.code)) updateSettings({ pttKey: e.code });
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [recording, updateSettings]);

  const deviceOptions = (list: MediaDeviceInfo[], kind: string) => [
    { value: "", label: "Default" },
    ...list.map((d, i) => ({ value: d.deviceId, label: d.label || `${kind} ${i + 1}` })),
  ];
  const levelPct = meterPercent(level);
  const thresholdPct = meterPercent(settings.threshold);
  const loudEnough = level >= settings.threshold;

  return (
    <div className="max-w-xl">
      <h2 className="text-title font-semibold text-ink tracking-tight mb-1">Voice</h2>
      <p className="text-meta text-muted mb-6">Saved on this device. Changes work in a call right away.</p>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-body font-semibold text-ink mb-1.5">Microphone</h3>
          <Dropdown value={settings.inputId} onChange={(v) => updateSettings({ inputId: v })} options={deviceOptions(devices.inputs, "Microphone")} />
        </div>
        {canPickOutput() && (
          <div>
            <h3 className="text-body font-semibold text-ink mb-1.5">Speakers</h3>
            <Dropdown value={settings.outputId} onChange={(v) => updateSettings({ outputId: v })} options={deviceOptions(devices.outputs, "Speaker")} />
          </div>
        )}
      </section>
      {!devices.named && (
        <p className="mt-2 text-meta text-muted">Start the mic test once to see your devices&apos; names.</p>
      )}

      <section className="mt-8">
        <h3 className="text-body font-semibold text-ink">Mic test</h3>
        <p className="mt-0.5 text-meta text-muted">Talk and watch the bar. Use headphones for &quot;hear yourself&quot;, or you&apos;ll get an echo.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setTesting((t) => !t)}
            className={`rounded-control px-3 py-1.5 text-body font-medium min-h-11 md:min-h-0 ${testing ? "border border-line text-ink hover:bg-surface-2" : "bg-accent hover:bg-accent-strong text-white"}`}>
            {testing ? "Stop test" : "Start mic test"}
          </button>
          <label className="flex items-center gap-2 text-body text-ink cursor-pointer">
            <input type="checkbox" checked={hearSelf} onChange={(e) => setHearSelf(e.target.checked)} className="w-4 h-4 accent-accent" />
            Hear yourself
          </label>
        </div>
        {testError && <p role="alert" className="mt-2 text-meta text-danger">{testError}</p>}
        {/* The loopback player for "hear yourself". */}
        <audio ref={loopbackRef} autoPlay muted className="hidden" />
      </section>

      <section className="mt-8">
        <h3 className="text-body font-semibold text-ink">Input mode</h3>
        <div className="mt-3 space-y-2" role="radiogroup" aria-label="Input mode">
          {MODES.map((m) => (
            <label key={m.value} className={`flex items-start gap-3 rounded-card border px-3 py-2.5 cursor-pointer ${
              settings.mode === m.value ? "border-accent bg-accent/10" : "border-line hover:bg-surface-2"
            }`}>
              <input type="radio" name="voice_mode" value={m.value} checked={settings.mode === m.value}
                onChange={() => updateSettings({ mode: m.value })} className="mt-1 w-4 h-4 accent-accent" />
              <span>
                <span className="block text-body text-ink">{m.label}</span>
                <span className="block text-meta text-muted">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {settings.mode === "voice" ? (
          <div className="mt-5">
            <div className="flex items-baseline justify-between">
              <h4 className="text-body font-semibold text-ink">Sensitivity</h4>
              <span className="text-meta text-muted">{testing ? (loudEnough ? "Sending" : "Too quiet — not sending") : "Start the mic test to see your level"}</span>
            </div>
            <p className="mt-0.5 text-meta text-muted">Drag the line just above your background noise. Sound to its left isn&apos;t sent.</p>
            {/* The level bar with the threshold drawn over it, and the slider that moves it. */}
            <div className="relative mt-3 h-3 rounded-pill bg-surface-2 overflow-hidden" aria-hidden="true">
              <div className={`absolute inset-y-0 left-0 transition-[width] duration-75 ${loudEnough ? "bg-online" : "bg-amber"}`} style={{ width: `${levelPct}%` }} />
              <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${thresholdPct}%` }} />
            </div>
            <input type="range" min={MIN_DB} max={0} step={1} value={settings.threshold}
              onChange={(e) => updateSettings({ threshold: Number(e.target.value) })}
              aria-label="Voice activity sensitivity" aria-valuetext={`${settings.threshold} dB`}
              className="mt-2 w-full accent-accent" />
            <div className="flex justify-between text-micro text-muted"><span>Picks up everything</span><span>Only loud talking</span></div>
          </div>
        ) : (
          <div className="mt-5">
            <h4 className="text-body font-semibold text-ink">Push-to-talk key</h4>
            <div className="mt-2 flex items-center gap-3">
              <kbd className="min-w-12 rounded-control border border-line bg-surface-2 px-3 py-1.5 text-center text-body font-semibold text-ink">
                {recording ? "…" : keyLabel(settings.pttKey)}
              </kbd>
              <button type="button" onClick={() => setRecording((r) => !r)}
                className="rounded-control bg-surface-2 hover:bg-line px-3 py-1.5 text-body text-ink min-h-11 md:min-h-0">
                {recording ? "Press a key… (Esc to cancel)" : "Change key"}
              </button>
            </div>
            <p className="mt-2 text-meta text-muted">
              Only works while Mallowchat is the tab you&apos;re looking at — browsers don&apos;t let websites see keys
              pressed in other apps. Pick a key you don&apos;t type with, or it&apos;ll also type that letter in messages.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

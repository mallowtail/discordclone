"use client";

import { useEffect, useRef } from "react";
import { useVoice, type VoiceParticipant } from "@/components/providers/VoiceProvider";
import { navCache } from "@/lib/cache/navCache";
import { Avatar } from "@/components/user/profile/Avatar";
import { ArrowsOut, Eye, EyeSlash, MonitorArrowUp } from "@phosphor-icons/react";

/**
 * The screens being shared in the call you're in. Others' screens start as a "Watch" card, and
 * the video only downloads once you press it (like Discord, and kind to the free plan's data). Your
 * own share shows a small preview with Stop sharing.
 */
export function ScreenShares({ className = "" }: { className?: string }) {
  const voice = useVoice();
  const sharers = voice.participants.filter((p) => p.sharing);
  if (voice.status !== "connected" || sharers.length === 0) return null;
  return (
    <section aria-label="Screen shares" className={`grid gap-3 ${sharers.length > 1 ? "lg:grid-cols-2" : ""} ${className}`}>
      {sharers.map((p) => <ScreenTile key={p.id} p={p} />)}
    </section>
  );
}

function ScreenTile({ p }: { p: VoiceParticipant }) {
  const voice = useVoice();
  const watched = p.isLocal || voice.watching.includes(p.id);

  if (!watched) {
    return (
      <div className="flex aspect-video max-h-[50vh] w-full flex-col items-center justify-center gap-3 rounded-card border border-line bg-surface p-4">
        <Avatar url={navCache.getProfile(p.id)?.avatar_url ?? null} name={p.name} seed={p.id} size="lg" />
        <p className="text-body text-ink text-center"><span className="font-semibold">{p.name}</span> is sharing their screen</p>
        <button type="button" onClick={() => voice.watch(p.id)}
          className="flex items-center gap-1.5 rounded-control bg-accent hover:bg-accent-strong px-4 py-2 text-body font-medium text-white min-h-11 md:min-h-0">
          <Eye size={16} weight="bold" aria-hidden="true" /> Watch
        </button>
      </div>
    );
  }
  return <ScreenVideo p={p} />;
}

function ScreenVideo({ p }: { p: VoiceParticipant }) {
  const voice = useVoice();
  const { attachScreen } = voice;
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Re-attach when the video arrives (screenReady) or the person changes.
  useEffect(() => {
    if (!p.screenReady || !videoRef.current) return;
    return attachScreen(p.id, videoRef.current);
  }, [p.id, p.screenReady, attachScreen]);

  const fullscreen = () => {
    const el = boxRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  const btn = "flex items-center gap-1.5 rounded-control bg-black/60 hover:bg-black/80 px-2.5 py-1.5 text-meta font-medium text-white min-h-11 md:min-h-0";
  return (
    <div ref={boxRef} className="group relative flex aspect-video max-h-[60vh] w-full items-center justify-center overflow-hidden rounded-card bg-black">
      <video ref={videoRef} autoPlay playsInline muted aria-label={`${p.isLocal ? "Your" : `${p.name}'s`} screen`}
        className="h-full w-full object-contain" />
      {!p.screenReady && <p className="absolute text-body text-white/70" role="status">Connecting to the stream…</p>}
      <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-control bg-black/60 px-2 py-1 text-meta text-white">
        <span className="rounded-sm bg-danger px-1 text-micro font-bold">LIVE</span>
        {p.isLocal ? "You're sharing your screen" : p.name}
      </div>
      <div className="absolute bottom-2 right-2 flex gap-2 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
        {p.isLocal ? (
          <button type="button" onClick={() => void voice.toggleShare()} className={btn}>
            <MonitorArrowUp size={15} weight="bold" aria-hidden="true" /> Stop sharing
          </button>
        ) : (
          <button type="button" onClick={() => voice.unwatch(p.id)} className={btn}>
            <EyeSlash size={15} weight="bold" aria-hidden="true" /> Stop watching
          </button>
        )}
        <button type="button" onClick={fullscreen} className={btn} aria-label="Fullscreen" title="Fullscreen">
          <ArrowsOut size={15} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

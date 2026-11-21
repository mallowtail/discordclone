"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAPTCHA_LOAD_MESSAGE, CAPTCHA_WAITING_MESSAGE } from "@/lib/users/captcha";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi> | null = null;
/** Loads Cloudflare's script once, however many widgets mount. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => { scriptPromise = null; s.remove(); reject(new Error("turnstile blocked")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** The Cloudflare bot-check widget. Reports a token (or null when it expires / is reset). Tokens are
 *  single-use: bump `resetCount` after every submit attempt to get a fresh one. */
export function Turnstile({ onToken, onError, resetCount }: {
  onToken: (token: string | null) => void;
  onError: () => void;
  resetCount: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const cbs = useRef({ onToken, onError });
  useEffect(() => { cbs.current = { onToken, onError }; });

  const firstReset = useRef(resetCount);
  useEffect(() => {
    if (resetCount === firstReset.current) return;
    cbs.current.onToken(null);
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, [resetCount]);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    loadTurnstile().then((api) => {
      if (cancelled || !el.current) return;
      widgetId.current = api.render(el.current, {
        sitekey: SITE_KEY,
        theme: "dark",
        // The normal widget is a fixed 300px; on narrow containers (phones) use the 150px compact one.
        size: el.current.clientWidth < 300 ? "compact" : "normal",
        callback: (t: string) => cbs.current.onToken(t),
        "expired-callback": () => cbs.current.onToken(null),
        "error-callback": () => cbs.current.onError(),
      });
    }).catch(() => { if (!cancelled) cbs.current.onError(); });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
      cbs.current.onToken(null);
    };
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={el} className="min-h-[65px] max-w-full overflow-hidden" />;
}

/** State for a form with a bot check. Without a site key everything is "ready" and no token is sent. */
export function useBotCheck() {
  const enabled = !!SITE_KEY;
  const [resetCount, setResetCount] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const onToken = useCallback((t: string | null) => { setToken(t); if (t) setFailed(false); }, []);
  const onError = useCallback(() => setFailed(true), []);
  const reset = useCallback(() => setResetCount((n) => n + 1), []);
  return {
    enabled, resetCount, onToken, onError, reset,
    token: token ?? undefined,
    // If the widget can't load or errors, don't lock people out: submit without a token and let
    // Supabase decide (it refuses with a captcha error once CAPTCHA is enforced).
    ready: !enabled || failed || !!token,
    /** Why the submit button is waiting (null when it isn't). */
    hint: !enabled ? null : failed ? CAPTCHA_LOAD_MESSAGE : token ? null : CAPTCHA_WAITING_MESSAGE,
    failed,
  };
}

export type BotCheck = ReturnType<typeof useBotCheck>;

/** The widget plus its waiting / failed hint, wired to a `useBotCheck()`. */
export function BotCheckField({ check }: { check: BotCheck }) {
  if (!check.enabled) return null;
  return (
    <div>
      <Turnstile resetCount={check.resetCount} onToken={check.onToken} onError={check.onError} />
      {check.hint && (
        <p role={check.failed ? "alert" : "status"} className={`mt-1 text-meta ${check.failed ? "text-danger" : "text-muted"}`}>
          {check.hint}
        </p>
      )}
    </div>
  );
}

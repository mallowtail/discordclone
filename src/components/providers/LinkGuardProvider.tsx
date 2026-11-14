"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { addTrustedDomain, linkDecision } from "@/lib/linkGuard";
import { Modal } from "@/components/ui/Modal";

type Ctx = {
  /** onClick / onAuxClick for an outside link: runs the warning instead of following it directly. */
  guard: (e: React.MouseEvent, href: string) => void;
};

const LinkGuardContext = createContext<Ctx>({ guard: () => {} });

function openInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * The "Leaving Mallowchat" warning, like Discord's. Links to this app open in place; sites the user
 * trusts open straight away; anything else shows the full real address first (link text can say
 * anything) with an option to trust that site from now on — saved on their account.
 */
export function LinkGuardProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();
  const [pending, setPending] = useState<{ url: string; hostname: string } | null>(null);
  const [trust, setTrust] = useState(false);

  const trusted = useMemo(() => profile?.trusted_domains ?? [], [profile]);

  const guard = useCallback(
    (e: React.MouseEvent, href: string) => {
      // Right-click (context menu, "copy link") is left alone; only actual navigation is guarded.
      if (e.button === 2) return;
      e.preventDefault();
      const d = linkDecision(href, window.location.origin, trusted);
      if (d.kind === "internal") router.push(d.path);
      else if (d.kind === "open") openInNewTab(d.url);
      else if (d.kind === "confirm") {
        setTrust(false);
        setPending({ url: d.url, hostname: d.hostname });
      }
    },
    [router, trusted]
  );

  function visit() {
    if (!pending) return;
    // Open first, inside the click, or browsers treat it as a pop-up and block it.
    openInNewTab(pending.url);
    if (trust && user) {
      const next = addTrustedDomain(trusted, pending.hostname);
      supabase.from("profiles").update({ trusted_domains: next }).eq("id", user.id).then(() => refreshProfile());
    }
    setPending(null);
  }

  // Show the hostname in bold inside the full address, so a look-alike stands out.
  let before = "";
  let host = "";
  let after = "";
  if (pending) {
    const i = pending.url.toLowerCase().indexOf(pending.hostname);
    if (i >= 0) {
      before = pending.url.slice(0, i);
      host = pending.url.slice(i, i + pending.hostname.length);
      after = pending.url.slice(i + pending.hostname.length);
    } else {
      after = pending.url;
    }
  }

  return (
    <LinkGuardContext.Provider value={{ guard }}>
      {children}
      {pending && (
        <Modal onClose={() => setPending(null)} title="Leaving Mallowchat" size="sm">
          <div className="px-5 py-4">
            <p className="text-body text-muted">This link is taking you to the following website:</p>
            <p className="mt-2 rounded-control bg-surface-2 border border-line px-3 py-2 text-body text-muted break-all">
              {before}<strong className="font-semibold text-ink">{host}</strong>{after}
            </p>
            <label className="mt-3 flex items-center gap-2 text-body text-ink min-h-11 md:min-h-0">
              <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="w-4 h-4 accent-accent" />
              Trust <strong className="font-semibold">{pending.hostname}</strong> links from now on
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPending(null)}
                className="rounded-control px-4 py-2 text-body font-medium text-ink hover:bg-surface-2">
                Go Back
              </button>
              <button type="button" onClick={visit}
                className="rounded-control bg-accent hover:bg-accent-strong px-4 py-2 text-body font-medium text-white">
                Visit Site
              </button>
            </div>
          </div>
        </Modal>
      )}
    </LinkGuardContext.Provider>
  );
}

export const useLinkGuard = () => useContext(LinkGuardContext);

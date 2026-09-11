"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { ProfileCard } from "@/components/user/ProfileCard";
import { FullProfileModal } from "@/components/user/FullProfileModal";

type OpenArgs = { userId: string; anchorRect: DOMRect; serverId?: string };
type FullArgs = { userId: string; serverId?: string };
type Ctx = {
  open: (userId: string, anchorRect: DOMRect, serverId?: string) => void;
  openFull: (userId: string, serverId?: string) => void;
};

const ProfilePopoverContext = createContext<Ctx>({ open: () => {}, openFull: () => {} });

export function ProfilePopoverProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OpenArgs | null>(null);
  const [full, setFull] = useState<FullArgs | null>(null);

  const open = useCallback((userId: string, anchorRect: DOMRect, serverId?: string) => {
    setState({ userId, anchorRect, serverId });
  }, []);
  const openFull = useCallback((userId: string, serverId?: string) => {
    setState(null); // close the small popover when expanding to the full modal
    setFull({ userId, serverId });
  }, []);
  const close = useCallback(() => setState(null), []);
  const closeFull = useCallback(() => setFull(null), []);

  return (
    <ProfilePopoverContext.Provider value={{ open, openFull }}>
      {children}
      {state && (
        <ProfileCard
          userId={state.userId}
          anchorRect={state.anchorRect}
          serverId={state.serverId}
          onClose={close}
          onOpenFull={() => openFull(state.userId, state.serverId)}
        />
      )}
      {full && <FullProfileModal userId={full.userId} serverId={full.serverId} onClose={closeFull} />}
    </ProfilePopoverContext.Provider>
  );
}

export const useProfilePopover = () => useContext(ProfilePopoverContext);

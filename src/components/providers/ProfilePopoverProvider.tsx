"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { ProfileCard } from "@/components/user/ProfileCard";

type OpenArgs = { userId: string; anchorRect: DOMRect; serverId?: string };
type Ctx = { open: (userId: string, anchorRect: DOMRect, serverId?: string) => void };

const ProfilePopoverContext = createContext<Ctx>({ open: () => {} });

export function ProfilePopoverProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OpenArgs | null>(null);
  const open = useCallback((userId: string, anchorRect: DOMRect, serverId?: string) => {
    setState({ userId, anchorRect, serverId });
  }, []);
  return (
    <ProfilePopoverContext.Provider value={{ open }}>
      {children}
      {state && (
        <ProfileCard
          userId={state.userId}
          anchorRect={state.anchorRect}
          serverId={state.serverId}
          onClose={() => setState(null)}
        />
      )}
    </ProfilePopoverContext.Provider>
  );
}

export const useProfilePopover = () => useContext(ProfilePopoverContext);

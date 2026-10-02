"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type DrawerState = {
  /** Whether the mobile nav drawer is open. Always false at `md` and up. */
  open: boolean;
  /** True below Tailwind's `md` breakpoint (768px) — the rail/sidebar render inside the
   *  Drawer rather than inline. */
  isMobile: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

const DrawerContext = createContext<DrawerState>({
  open: false,
  isMobile: false,
  openDrawer: () => {},
  closeDrawer: () => {},
  toggleDrawer: () => {},
});

export function useDrawer() {
  return useContext(DrawerContext);
}

/**
 * Task 7: tracks whether the rail/channel-sidebar nav should render inside Task 2's Drawer
 * (below `md`) or inline (at `md` and up), and holds the drawer's own open state.
 *
 * Consumed by `(app)/layout.tsx` (to pick inline vs. Drawer-wrapped rendering), by the
 * channel/DM page headers (the hamburger trigger), and by ServerSidebar/DmSidebar (closing
 * the drawer when a channel/DM is opened).
 */
export function DrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  // The lazy `useState` initializer above already gets `isMobile` right for the first render;
  // this effect only needs to track it across *subsequent* viewport changes, via the media
  // query's own change event — so, unlike that initializer, it has no reason to call
  // `setIsMobile` synchronously from the effect body itself.
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    function onChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches);
      // If a resize carries the viewport up to `md`+ while the drawer happens to be open,
      // don't leave it mounted as a stray overlay once the nav starts rendering inline.
      if (!e.matches) setOpen(false);
    }
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const openDrawer = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);
  const toggleDrawer = useCallback(() => setOpen((o) => !o), []);

  return (
    <DrawerContext.Provider value={{ open, isMobile, openDrawer, closeDrawer, toggleDrawer }}>
      {children}
    </DrawerContext.Provider>
  );
}

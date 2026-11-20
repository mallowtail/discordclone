"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { MessageGif } from "@/lib/messages/gifs";

export const MAX_FAVORITE_GIFS = 100;

type Ctx = {
  favorites: MessageGif[];
  isFavorite: (url: string) => boolean;
  /** Add or remove; resolves to an error message if it couldn't be saved. */
  toggle: (gif: MessageGif) => Promise<string | null>;
};

const FavoriteGifsContext = createContext<Ctx>({ favorites: [], isFavorite: () => false, toggle: async () => null });

/** The signed-in user's favourite GIFs (saved on their account), newest first. */
export function FavoriteGifsProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [state, setState] = useState<{ owner: string; list: MessageGif[] } | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase.from("favorite_gifs").select("url, width, height, title").order("created_at", { ascending: false })
      .then(({ data }) => {
        if (active && data) setState({ owner: user.id, list: data as MessageGif[] });
      });
    return () => { active = false; };
  }, [supabase, user]);

  const favorites = useMemo(() => (state && user && state.owner === user.id ? state.list : []), [state, user]);
  const isFavorite = useCallback((url: string) => favorites.some((f) => f.url === url), [favorites]);

  const toggle = useCallback(async (gif: MessageGif): Promise<string | null> => {
    if (!user) return "Sign in first";
    const owner = user.id;
    const had = favorites.some((f) => f.url === gif.url);
    if (!had && favorites.length >= MAX_FAVORITE_GIFS) return `You can keep up to ${MAX_FAVORITE_GIFS} favorite GIFs`;
    // Update straight away; put it back if saving fails.
    const before = favorites;
    setState({ owner, list: had ? favorites.filter((f) => f.url !== gif.url) : [gif, ...favorites] });
    const { error } = had
      ? await supabase.from("favorite_gifs").delete().eq("url", gif.url)
      : await supabase.from("favorite_gifs").insert({ url: gif.url, width: gif.width, height: gif.height, title: gif.title.slice(0, 200) });
    if (error) {
      setState({ owner, list: before });
      return "Couldn't save that — try again";
    }
    return null;
  }, [supabase, user, favorites]);

  return (
    <FavoriteGifsContext.Provider value={{ favorites, isFavorite, toggle }}>{children}</FavoriteGifsContext.Provider>
  );
}

export const useFavoriteGifs = () => useContext(FavoriteGifsContext);
